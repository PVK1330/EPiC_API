// Calendar Sync Service
//
// Pulls events that already exist on the user's connected external calendars
// (Outlook/Teams, Google) into `calendar_meetings`, so the in-app calendar shows
// what is genuinely booked rather than only the meetings created from inside the
// app. Before this existed, `syncTeamsMeetings` was a stub that always answered
// `{ synced: 0 }` and never contacted any provider.

import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { listOutlookCalendarEvents } from './microsoft/microsoftMeeting.service.js';
import { listGoogleCalendarEvents } from './google/googleMeeting.service.js';

const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 180;

// A GET on the calendar refreshes in the background, but only this often — a
// Graph round-trip on every page render would make the calendar feel broken.
export const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

const PROVIDERS = [
  {
    provider: 'microsoft',
    eventType: 'teams',
    defaultLocation: 'Microsoft Teams',
    list: listOutlookCalendarEvents,
  },
  {
    provider: 'google',
    eventType: 'google',
    defaultLocation: 'Google Meet',
    list: listGoogleCalendarEvents,
  },
];

const resolveWindow = ({ startDate, endDate } = {}) => {
  const now = Date.now();
  const start = startDate ? new Date(startDate) : new Date(now - DEFAULT_PAST_DAYS * 86400000);
  const end = endDate ? new Date(endDate) : new Date(now + DEFAULT_FUTURE_DAYS * 86400000);
  return {
    windowStart: Number.isNaN(start.getTime()) ? new Date(now - DEFAULT_PAST_DAYS * 86400000) : start,
    windowEnd: Number.isNaN(end.getTime()) ? new Date(now + DEFAULT_FUTURE_DAYS * 86400000) : end,
  };
};

const getActiveConnections = async (tenantDb, userId) => {
  if (!tenantDb?.CalendarConnection) return [];
  return tenantDb.CalendarConnection.findAll({
    where: {
      user_id: userId,
      is_active: true,
      provider: { [Op.in]: PROVIDERS.map((p) => p.provider) },
    },
  });
};

const markConnection = async (connection, patch) => {
  if (!connection) return;
  await connection.update(patch).catch((err) => {
    logger.warn({ err, connectionId: connection.id }, 'Failed to record calendar sync outcome');
  });
};

/**
 * Pulls one provider's events into calendar_meetings for a single user.
 * Returns per-provider counters; never throws — a dead provider must not stop
 * the other one, nor break the calendar page that triggered the sync.
 */
const syncProvider = async ({ tenantDb, userId, connection, config, windowStart, windowEnd }) => {
  const result = { provider: config.provider, created: 0, updated: 0, cancelled: 0, error: null };

  try {
    const events = await config.list({
      tenantDb,
      userId,
      startTime: windowStart,
      endTime: windowEnd,
    });

    const seenIds = [];

    for (const event of events) {
      if (!event.externalId) continue;
      seenIds.push(event.externalId);

      const payload = {
        user_id: userId,
        subject: event.subject,
        description: event.description || '',
        start_time: event.startTime,
        end_time: event.endTime,
        attendees: event.attendees || [],
        meeting_type: event.joinUrl ? 'online' : 'in-person',
        join_url: event.joinUrl || null,
        status: event.isCancelled ? 'cancelled' : 'scheduled',
        event_type: config.eventType,
        location: event.location || (event.joinUrl ? config.defaultLocation : ''),
        meeting_provider: config.provider,
        external_event_id: event.externalId,
      };

      const existing = await tenantDb.CalendarMeeting.findOne({
        where: {
          user_id: userId,
          meeting_provider: config.provider,
          external_event_id: event.externalId,
        },
      });

      if (existing) {
        // `related_case_id` and `reminder_minutes` are set in-app and have no
        // counterpart on the provider, so `payload` deliberately omits them —
        // a pull must not wipe what the caseworker linked here.
        await existing.update(payload);
        result.updated += 1;
      } else {
        await tenantDb.CalendarMeeting.create({ ...payload, related_case_id: null, reminder_minutes: 15 });
        result.created += 1;
      }
    }

    // Anything we previously stored for this provider that is no longer in the
    // remote window was deleted or declined externally. Mark it cancelled so it
    // stops showing, rather than leaving a ghost on the calendar forever.
    const staleWhere = {
      user_id: userId,
      meeting_provider: config.provider,
      status: 'scheduled',
      start_time: { [Op.between]: [windowStart, windowEnd] },
      external_event_id: seenIds.length
        ? { [Op.and]: [{ [Op.ne]: null }, { [Op.notIn]: seenIds }] }
        : { [Op.ne]: null },
    };
    const [cancelled] = await tenantDb.CalendarMeeting.update({ status: 'cancelled' }, { where: staleWhere });
    result.cancelled = cancelled || 0;

    await markConnection(connection, {
      last_sync_status: 'CONNECTED',
      last_successful_sync: new Date(),
      error_message: null,
    });
  } catch (error) {
    result.error = error.message;
    logger.error({ err: error, userId, provider: config.provider }, 'Calendar sync failed for provider');
    await markConnection(connection, {
      last_sync_status: 'ERROR',
      last_failed_sync: new Date(),
      error_message: String(error.message || error).slice(0, 500),
    });
  }

  return result;
};

/**
 * Syncs every connected provider for a user.
 *
 * @returns {Promise<{synced:number, created:number, updated:number, cancelled:number, providers:Array, connected:boolean, skipped:boolean}>}
 */
export const syncUserCalendars = async ({ tenantDb, userId, startDate, endDate, force = false }) => {
  const summary = {
    synced: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    providers: [],
    connected: false,
    skipped: false,
  };

  if (!tenantDb?.CalendarMeeting) {
    logger.warn({ userId }, 'CalendarMeeting model unavailable; skipping calendar sync');
    return summary;
  }

  const connections = await getActiveConnections(tenantDb, userId);
  if (!connections.length) return summary;

  summary.connected = true;
  const { windowStart, windowEnd } = resolveWindow({ startDate, endDate });

  const due = connections.filter((connection) => {
    if (force) return true;
    const last = connection.last_successful_sync
      ? new Date(connection.last_successful_sync).getTime()
      : 0;
    return Date.now() - last > SYNC_COOLDOWN_MS;
  });

  if (!due.length) {
    summary.skipped = true;
    return summary;
  }

  for (const connection of due) {
    const config = PROVIDERS.find((p) => p.provider === connection.provider);
    if (!config) continue;

    const result = await syncProvider({ tenantDb, userId, connection, config, windowStart, windowEnd });
    summary.providers.push(result);
    summary.created += result.created;
    summary.updated += result.updated;
    summary.cancelled += result.cancelled;
  }

  summary.synced = summary.created + summary.updated;
  return summary;
};

/**
 * Best-effort refresh used by the read endpoints. Swallows everything: a
 * provider outage must never turn "show me my calendar" into a 500.
 */
export const refreshCalendarsQuietly = async ({ tenantDb, userId, startDate, endDate }) => {
  try {
    return await syncUserCalendars({ tenantDb, userId, startDate, endDate, force: false });
  } catch (error) {
    logger.warn({ err: error, userId }, 'Background calendar refresh failed; serving stored meetings');
    return null;
  }
};
