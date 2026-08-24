import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { getConnection } from './google/google.service.js';
import { createGoogleMeetMeeting } from './google/googleMeeting.service.js';
import { syncUserCalendars, refreshCalendarsQuietly } from './calendarSync.service.js';
import { sendMeetingInvites, extractAttendeeEmails } from './meetingInvite.service.js';

const normalizeMeeting = (row) => {
  const plain = row.get ? row.get({ plain: true }) : row;
  return {
    id: plain.id,
    subject: plain.subject,
    description: plain.description || '',
    start_time:
      plain.start_time instanceof Date
        ? plain.start_time.toISOString()
        : plain.start_time,
    end_time:
      plain.end_time instanceof Date
        ? plain.end_time.toISOString()
        : plain.end_time,
    attendees: plain.attendees || [],
    meeting_type: plain.meeting_type || 'online',
    reminder_minutes: plain.reminder_minutes ?? 15,
    related_case_id: plain.related_case_id ?? null,
    join_url: plain.join_url,
    status: plain.status,
    event_type: plain.event_type || 'teams',
    location: plain.location || '',
    meeting_provider: plain.meeting_provider || null,
    external_event_id: plain.external_event_id || null,
    created_at:
      plain.created_at instanceof Date
        ? plain.created_at.toISOString()
        : plain.created_at,
    updated_at:
      plain.updated_at instanceof Date
        ? plain.updated_at.toISOString()
        : plain.updated_at,
  };
};

/**
 * Dispatches invite/update/cancellation mail without blocking the HTTP response.
 *
 * SMTP here is synchronous and a slow relay can outlast the frontend's request
 * timeout, so the meeting is saved and answered first and the mail goes out
 * behind it — the same fire-and-forget shape the notification path uses.
 */
const dispatchInvites = (params) => {
  sendMeetingInvites(params).catch((err) => {
    logger.error({ err, meetingId: params?.meeting?.id }, 'Meeting invite dispatch failed');
  });
};

export const createTeamsMeeting = async (req, res) => {
  try {
    const userId = req.user.userId;
    const organisationId = req.user.organisation_id;
    const {
      subject,
      description,
      start_time,
      end_time,
      attendees,
      meeting_type,
      reminder_minutes,
      related_case_id,
      event_type,
      location,
      meeting_provider: requestedProvider,
    } = req.body;

    if (!subject || !start_time || !end_time) {
      return res.status(400).json({
        status: 'error',
        message: 'subject, start_time, and end_time are required',
        data: null,
      });
    }

    let meetingProvider = null;
    let externalEventId = null;
    let joinUrl = null;
    let finalEventType = event_type || 'meeting';
    let finalLocation = location || '';

    // Normalise the requested platform. 'none' (or unset/'in-person'/'phone')
    // means the user does not want an online meeting link generated.
    const provider = String(requestedProvider || '').toLowerCase();
    const wantsGoogle = provider === 'google' || provider === 'google_meet';
    const wantsMicrosoft = provider === 'microsoft' || provider === 'teams';

    const attendeeEmails = extractAttendeeEmails(attendees);

    // ── Google Meet (explicitly requested) ─────────────────────────────────
    if (wantsGoogle) {
      let googleConnection = null;
      try {
        googleConnection = await getConnection(req.tenantDb, userId);
      } catch (dbErr) {
        logger.warn({ err: dbErr }, 'Failed to check Google connection');
      }

      if (!googleConnection) {
        return res.status(400).json({
          status: 'error',
          message: 'Google Meet is not connected for your account. Connect Google from the calendar, then try again.',
          data: { provider: 'google', connected: false },
        });
      }

      try {
        const meetResult = await createGoogleMeetMeeting({
          tenantDb: req.tenantDb,
          title: subject,
          description: description || '',
          startTime: start_time,
          endTime: end_time,
          attendees: attendeeEmails,
          userId,
        });
        meetingProvider = 'google';
        externalEventId = meetResult.eventId;
        joinUrl = meetResult.meetUrl;
        finalEventType = 'google';
        finalLocation = 'Google Meet';
        logger.info({ userId, eventId: meetResult.eventId }, 'Google Meet link generated');
      } catch (meetErr) {
        logger.error({ err: meetErr, userId }, 'Failed to generate Google Meet link');
        return res.status(502).json({
          status: 'error',
          message: 'Could not create the Google Meet link. Your Google connection may need to be reconnected.',
          data: { provider: 'google' },
        });
      }
    }

    // ── Microsoft Teams (explicitly requested) ─────────────────────────────
    if (wantsMicrosoft) {
      let microsoftConnection = null;
      try {
        if (!req.tenantDb?.CalendarConnection) {
          throw new Error('CalendarConnection model not available');
        }
        microsoftConnection = await req.tenantDb.CalendarConnection.findOne({
          where: { user_id: userId, provider: 'microsoft', is_active: true },
        });
      } catch (msDbErr) {
        logger.warn({ err: msDbErr }, 'Failed to check Microsoft connection');
      }

      if (!microsoftConnection) {
        return res.status(400).json({
          status: 'error',
          message: 'Microsoft Teams is not connected for your account. Connect Microsoft from the calendar, then try again.',
          data: { provider: 'microsoft', connected: false },
        });
      }

      try {
        // createTeamsCalendarMeeting, not createTeamsOnlineMeeting: the latter
        // posts to /me/onlineMeetings, which mints a join link but creates no
        // calendar entry and invites nobody — the meeting was invisible in
        // Outlook and Teams, and so could never sync back to this calendar.
        const { createTeamsCalendarMeeting } = await import('./microsoft/microsoftMeeting.service.js');
        const teamsResult = await createTeamsCalendarMeeting({
          tenantDb: req.tenantDb,
          userId,
          title: subject,
          description: description || '',
          startTime: start_time,
          endTime: end_time,
          attendees: attendeeEmails,
          location: 'Microsoft Teams',
        });
        meetingProvider = 'microsoft';
        externalEventId = teamsResult.eventId;
        joinUrl = teamsResult.meetUrl;
        finalEventType = 'teams';
        finalLocation = 'Microsoft Teams';
        logger.info({ userId, eventId: teamsResult.eventId }, 'Microsoft Teams link generated');
      } catch (teamsErr) {
        logger.error({ err: teamsErr, userId }, 'Failed to generate Teams link');
        return res.status(502).json({
          status: 'error',
          message: 'Could not create the Microsoft Teams link. Your Microsoft connection may need to be reconnected.',
          data: { provider: 'microsoft' },
        });
      }
    }

    // ── No online provider requested — plain calendar entry ────────────────
    const row = await req.tenantDb.CalendarMeeting.create({
      user_id: userId,
      subject,
      description: description || '',
      start_time,
      end_time,
      attendees: Array.isArray(attendees) ? attendees : [],
      meeting_type: meeting_type || 'online',
      reminder_minutes: reminder_minutes ?? 15,
      related_case_id: related_case_id || null,
      event_type: finalEventType,
      location: finalLocation,
      meeting_provider: meetingProvider,
      external_event_id: externalEventId,
      join_url: joinUrl,
      status: 'scheduled',
    });

    const meeting = normalizeMeeting(row);

    dispatchInvites({
      tenantDb: req.tenantDb,
      meeting,
      organiserId: userId,
      organisationId,
      variant: 'created',
    });

    res.status(201).json({
      status: 'success',
      message: attendeeEmails.length
        ? `Meeting created. The joining link is on its way to ${attendeeEmails.length} attendee${attendeeEmails.length === 1 ? '' : 's'}.`
        : 'Meeting created',
      data: { ...meeting, invited: attendeeEmails },
    });
  } catch (error) {
    logger.error({ err: error }, 'createTeamsMeeting error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to create meeting',
      data: null,
    });
  }
};

/**
 * POST /api/teams-meetings/sync
 * Pulls the user's existing Outlook/Teams and Google Calendar events into the
 * in-app calendar. Was previously a stub that always reported 0 synced.
 */
export const syncTeamsMeetings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start_date, end_date } = req.query;

    const summary = await syncUserCalendars({
      tenantDb: req.tenantDb,
      userId,
      startDate: start_date,
      endDate: end_date,
      force: true,
    });

    if (!summary.connected) {
      return res.status(200).json({
        status: 'success',
        message: 'No calendar is connected yet. Connect Microsoft or Google to pull in your existing meetings.',
        data: { ...summary },
      });
    }

    const failed = summary.providers.filter((p) => p.error);
    const message = failed.length
      ? `Synced ${summary.synced} meeting(s). ${failed.map((f) => `${f.provider}: ${f.error}`).join('; ')}`
      : `Synced ${summary.synced} meeting(s) from your connected calendar${summary.providers.length > 1 ? 's' : ''}.`;

    res.status(200).json({
      status: failed.length === summary.providers.length && failed.length ? 'error' : 'success',
      message,
      data: summary,
    });
  } catch (error) {
    logger.error({ err: error }, 'syncTeamsMeetings error');
    res.status(500).json({
      status: 'error',
      message: 'Sync failed',
      data: null,
    });
  }
};

export const getTeamsMeetings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start_date, end_date } = req.query;

    // Refresh from the connected providers before answering, so meetings booked
    // directly in Outlook or Google appear here without anyone pressing Sync.
    // Rate-limited and fail-soft inside the service.
    await refreshCalendarsQuietly({
      tenantDb: req.tenantDb,
      userId,
      startDate: start_date,
      endDate: end_date,
    });

    const where = {
      user_id: userId,
      status: { [Op.ne]: 'cancelled' },
    };

    if (start_date && end_date) {
      where.start_time = {
        [Op.between]: [new Date(start_date), new Date(end_date)],
      };
    } else if (start_date) {
      where.start_time = { [Op.gte]: new Date(start_date) };
    } else if (end_date) {
      where.start_time = { [Op.lte]: new Date(end_date) };
    }

    const rows = await req.tenantDb.CalendarMeeting.findAll({
      where,
      order: [['start_time', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      message: 'Meetings retrieved',
      data: { meetings: rows.map(normalizeMeeting) },
    });
  } catch (error) {
    logger.error({ err: error }, 'getTeamsMeetings error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to list meetings',
      data: null,
    });
  }
};

export const getUpcomingTeamsMeetings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const days = Math.min(
      365,
      Math.max(1, parseInt(req.query.days, 10) || 30),
    );
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    await refreshCalendarsQuietly({ tenantDb: req.tenantDb, userId });

    const rows = await req.tenantDb.CalendarMeeting.findAll({
      where: {
        user_id: userId,
        status: { [Op.ne]: 'cancelled' },
        start_time: { [Op.gte]: now, [Op.lte]: until },
      },
      order: [['start_time', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      message: 'Upcoming meetings',
      data: { meetings: rows.map(normalizeMeeting) },
    });
  } catch (error) {
    logger.error({ err: error }, 'getUpcomingTeamsMeetings error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to load upcoming meetings',
      data: null,
    });
  }
};

export const getTeamsMeetingById = async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    const row = await req.tenantDb.CalendarMeeting.findOne({
      where: { id, user_id: userId },
    });
    if (!row) {
      return res.status(404).json({
        status: 'error',
        message: 'Meeting not found',
        data: null,
      });
    }
    res.status(200).json({
      status: 'success',
      message: 'Meeting retrieved',
      data: normalizeMeeting(row),
    });
  } catch (error) {
    logger.error({ err: error }, 'getTeamsMeetingById error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to load meeting',
      data: null,
    });
  }
};

/**
 * Pushes a local edit out to whichever provider owns the event. Best-effort:
 * the local row is the source of truth for the in-app calendar, and a provider
 * hiccup must not block the edit.
 */
const pushUpdateToProvider = async ({ tenantDb, userId, row, attendeeEmails }) => {
  if (!row.meeting_provider || !row.external_event_id) return;

  try {
    if (row.meeting_provider === 'microsoft') {
      const { updateOutlookCalendarEvent } = await import('./microsoft/microsoftMeeting.service.js');
      await updateOutlookCalendarEvent({
        tenantDb,
        userId,
        eventId: row.external_event_id,
        title: row.subject,
        startTime: row.start_time,
        endTime: row.end_time,
      });
    } else if (row.meeting_provider === 'google') {
      const { updateGoogleCalendarEvent } = await import('./google/googleMeeting.service.js');
      await updateGoogleCalendarEvent({
        tenantDb,
        userId,
        eventId: row.external_event_id,
        title: row.subject,
        description: row.description || '',
        startTime: row.start_time,
        endTime: row.end_time,
        attendees: attendeeEmails,
      });
    }
  } catch (err) {
    logger.error(
      { err, userId, provider: row.meeting_provider, eventId: row.external_event_id },
      'Failed to push meeting update to provider',
    );
  }
};

export const updateTeamsMeeting = async (req, res) => {
  try {
    const userId = req.user.userId;
    const organisationId = req.user.organisation_id;
    const id = parseInt(req.params.id, 10);
    const row = await req.tenantDb.CalendarMeeting.findOne({
      where: { id, user_id: userId },
    });
    if (!row) {
      return res.status(404).json({
        status: 'error',
        message: 'Meeting not found',
        data: null,
      });
    }

    const allowed = [
      'subject',
      'description',
      'start_time',
      'end_time',
      'attendees',
      'meeting_type',
      'reminder_minutes',
      'related_case_id',
      'event_type',
      'location',
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    // Only the fields that attendees would need to re-read warrant an email.
    const notifiable = ['subject', 'start_time', 'end_time', 'location', 'description'];
    const changed = notifiable.some(
      (key) => patch[key] !== undefined && String(patch[key]) !== String(row[key]),
    );

    await row.update(patch);
    await row.reload();

    const meeting = normalizeMeeting(row);
    const attendeeEmails = extractAttendeeEmails(meeting.attendees);

    await pushUpdateToProvider({ tenantDb: req.tenantDb, userId, row, attendeeEmails });

    if (changed) {
      dispatchInvites({
        tenantDb: req.tenantDb,
        meeting,
        organiserId: userId,
        organisationId,
        variant: 'updated',
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Meeting updated',
      data: meeting,
    });
  } catch (error) {
    logger.error({ err: error }, 'updateTeamsMeeting error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to update meeting',
      data: null,
    });
  }
};

export const cancelTeamsMeeting = async (req, res) => {
  try {
    const userId = req.user.userId;
    const organisationId = req.user.organisation_id;
    const id = parseInt(req.params.id, 10);
    const row = await req.tenantDb.CalendarMeeting.findOne({
      where: { id, user_id: userId },
    });
    if (!row) {
      return res.status(404).json({
        status: 'error',
        message: 'Meeting not found',
        data: null,
      });
    }

    const meeting = normalizeMeeting(row);
    await row.update({ status: 'cancelled' });

    // Remove it from the provider too, otherwise the next sync pulls it straight
    // back in as a live meeting.
    if (row.meeting_provider && row.external_event_id) {
      try {
        if (row.meeting_provider === 'microsoft') {
          const { deleteOutlookCalendarEvent } = await import('./microsoft/microsoftMeeting.service.js');
          await deleteOutlookCalendarEvent({ tenantDb: req.tenantDb, userId, eventId: row.external_event_id });
        } else if (row.meeting_provider === 'google') {
          const { deleteGoogleCalendarEvent } = await import('./google/googleMeeting.service.js');
          await deleteGoogleCalendarEvent({ tenantDb: req.tenantDb, userId, eventId: row.external_event_id });
        }
      } catch (err) {
        logger.error(
          { err, userId, provider: row.meeting_provider },
          'Failed to cancel meeting on provider; local row is cancelled',
        );
      }
    }

    dispatchInvites({
      tenantDb: req.tenantDb,
      meeting,
      organiserId: userId,
      organisationId,
      variant: 'cancelled',
    });

    res.status(200).json({
      status: 'success',
      message: 'Meeting cancelled',
      data: { id, status: 'cancelled' },
    });
  } catch (error) {
    logger.error({ err: error }, 'cancelTeamsMeeting error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to cancel meeting',
      data: null,
    });
  }
};
