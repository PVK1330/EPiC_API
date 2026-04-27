/**
 * Teams meetings — in-memory store per user until Graph sync is implemented.
 * Shape matches frontend: subject, start_time, end_time, attendees, join_url, status.
 */

const meetingsByUserId = new Map();
let nextId = 1;

const userList = (userId) => {
  if (!meetingsByUserId.has(userId)) {
    meetingsByUserId.set(userId, []);
  }
  return meetingsByUserId.get(userId);
};

const makeJoinUrl = (id) =>
  `https://teams.microsoft.com/l/meetup-join/placeholder-${id}`;

const normalizeMeeting = (row) => ({
  id: row.id,
  subject: row.subject,
  description: row.description || '',
  start_time: row.start_time,
  end_time: row.end_time,
  attendees: row.attendees || [],
  meeting_type: row.meeting_type || 'online',
  reminder_minutes: row.reminder_minutes ?? 15,
  related_case_id: row.related_case_id ?? null,
  join_url: row.join_url,
  status: row.status,
  event_type: row.event_type || 'teams',
  location: row.location || '',
  created_at: row.created_at,
  updated_at: row.updated_at,
});

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

    const list = userList(userId);
    const id = nextId++;
    const now = new Date().toISOString();
    const row = {
      id,
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
      join_url: makeJoinUrl(id),
      status: 'scheduled',
      created_at: now,
      updated_at: now,
    };
    list.push(row);

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
    // TODO: pull from Microsoft Graph when OAuth is connected
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
    let list = [...userList(userId)];

    const { start_date, end_date } = req.query;
    if (start_date) {
      const s = new Date(start_date).getTime();
      list = list.filter((m) => new Date(m.start_time).getTime() >= s);
    }
    if (end_date) {
      const e = new Date(end_date).getTime();
      list = list.filter((m) => new Date(m.start_time).getTime() <= e);
    }

    list.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );

    res.status(200).json({
      status: 'success',
      message: 'Meetings retrieved',
      data: { meetings: list.map(normalizeMeeting) },
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

    const list = userList(userId).filter((m) => {
      const start = new Date(m.start_time);
      return start >= now && start <= until && m.status !== 'cancelled';
    });

    list.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );

    res.status(200).json({
      status: 'success',
      message: 'Upcoming meetings',
      data: { meetings: list.map(normalizeMeeting) },
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
    const row = userList(userId).find((m) => m.id === id);
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
    const list = userList(userId);
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) {
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
    const row = { ...list[idx], updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) row[key] = req.body[key];
    }
    list[idx] = row;

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
    const list = userList(userId);
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) {
      return res.status(404).json({
        status: 'error',
        message: 'Meeting not found',
        data: null,
      });
    }
    list[idx] = {
      ...list[idx],
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    };

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
