import { Op } from 'sequelize';
import db from '../models/index.js';

const CalendarMeeting = db.CalendarMeeting;

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

    const row = await CalendarMeeting.create({
      user_id: userId,
      subject,
      description: description || '',
      start_time,
      end_time,
      attendees: Array.isArray(attendees) ? attendees : [],
      meeting_type: meeting_type || 'online',
      reminder_minutes: reminder_minutes ?? 15,
      related_case_id: related_case_id || null,
      event_type: event_type || 'teams',
      location: location || '',
      join_url: null,
      status: 'scheduled',
    });

    await row.update({ join_url: makeJoinUrl(row.id) });
    await row.reload();

    res.status(201).json({
      status: 'success',
      message: 'Meeting created',
      data: normalizeMeeting(row),
    });
  } catch (error) {
    console.error('createTeamsMeeting error:', error);
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
    console.error('syncTeamsMeetings error:', error);
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

    const rows = await CalendarMeeting.findAll({
      where,
      order: [['start_time', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      message: 'Meetings retrieved',
      data: { meetings: rows.map(normalizeMeeting) },
    });
  } catch (error) {
    console.error('getTeamsMeetings error:', error);
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

    const rows = await CalendarMeeting.findAll({
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
    console.error('getUpcomingTeamsMeetings error:', error);
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
    const row = await CalendarMeeting.findOne({
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
    console.error('getTeamsMeetingById error:', error);
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
    const row = await CalendarMeeting.findOne({
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
    console.error('updateTeamsMeeting error:', error);
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
    const row = await CalendarMeeting.findOne({
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
    console.error('cancelTeamsMeeting error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to cancel meeting',
      data: null,
    });
  }
};
