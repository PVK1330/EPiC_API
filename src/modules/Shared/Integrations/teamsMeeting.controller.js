import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { getConnection } from './google/google.service.js';
import { createGoogleMeetMeeting } from './google/googleMeeting.service.js';

const makeJoinUrl = (id) =>
  `https://teams.microsoft.com/l/meetup-join/placeholder-${id}`;

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

export const createTeamsMeeting = async (req, res) => {
  try {
    const userId = req.user.userId;
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
    let finalEventType = event_type || 'teams';
    let finalLocation = location || '';

    // ── Priority 1: Google Meet ────────────────────────────────────────────
    let googleConnection = null;
    try {
      googleConnection = await getConnection(req.tenantDb, userId);
    } catch (dbErr) {
      logger.warn({ err: dbErr }, 'Failed to check Google connection, trying Microsoft next');
    }

    if (googleConnection) {
      try {
        const attendeeEmails = Array.isArray(attendees)
          ? attendees.map(a => typeof a === 'string' ? a : a.email).filter(Boolean)
          : [];

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

        logger.info({ userId, eventId: meetResult.eventId }, 'Google Meet link generated successfully');
      } catch (meetErr) {
        logger.error({ err: meetErr, userId }, 'Failed to generate Google Meet link, falling back to Microsoft check');
      }
    }

    // ── Priority 2: Microsoft Teams (only if Google did not produce a link) ──
    if (!joinUrl) {
      let microsoftConnection = null;
      try {
        if (!req.tenantDb?.CalendarConnection) {
          throw new Error('CalendarConnection model not available');
        }
        microsoftConnection = await req.tenantDb.CalendarConnection.findOne({
          where: { user_id: userId, provider: 'microsoft', is_active: true },
        });
      } catch (msDbErr) {
        logger.warn({ err: msDbErr }, 'Failed to check Microsoft connection, proceeding without Teams link');
      }

      if (microsoftConnection) {
        try {
          const { createTeamsOnlineMeeting } = await import('./microsoft/microsoftMeeting.service.js');

          const teamsResult = await createTeamsOnlineMeeting({
            tenantDb: req.tenantDb,
            title: subject,
            description: description || '',
            startTime: start_time,
            endTime: end_time,
            userId,
          });

          meetingProvider = 'microsoft';
          externalEventId = teamsResult.eventId;
          joinUrl = teamsResult.meetUrl;
          finalEventType = 'teams';
          finalLocation = 'Microsoft Teams';

          logger.info({ userId, eventId: teamsResult.eventId }, 'Microsoft Teams link generated successfully');
        } catch (teamsErr) {
          logger.error({ err: teamsErr, userId }, 'Failed to generate Teams link, proceeding without meeting link');
        }
      }
    }

    // ── Priority 3: No integration — plain meeting ─────────────────────────
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

    // If no external integration provided a real URL, generate placeholder
    if (!joinUrl) {
      await row.update({ join_url: makeJoinUrl(row.id) });
      await row.reload();
    }

    res.status(201).json({
      status: 'success',
      message: 'Meeting created',
      data: normalizeMeeting(row),
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

export const syncTeamsMeetings = async (req, res) => {
  try {
    res.status(200).json({
      status: 'success',
      message: 'Sync completed (no external calendar connected)',
      data: { synced: 0 },
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

export const updateTeamsMeeting = async (req, res) => {
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
    await row.update(patch);
    await row.reload();

    res.status(200).json({
      status: 'success',
      message: 'Meeting updated',
      data: normalizeMeeting(row),
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
    await row.update({ status: 'cancelled' });

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
