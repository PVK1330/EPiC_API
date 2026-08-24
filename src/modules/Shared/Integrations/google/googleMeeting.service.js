// Google Meeting Service
// Created at: 2026-05-29

import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";
import { getOAuth2Client } from "./google.oauth.js";
import { getOrRefreshAccessToken } from "./googleToken.service.js";
import { getConnection } from "./google.service.js";
import logger from "../../../../utils/logger.js";

/**
 * Schedules an online meeting on the user's Google Calendar and returns 
 * meeting join URL, Google event ID, and web event link.
 * 
 * @param {object} params
 * @param {object} params.tenantDb - Tenant database context
 * @param {string} params.title - Meeting subject
 * @param {string} params.description - Meeting agenda
 * @param {string|Date} params.startTime - Event start datetime
 * @param {string|Date} params.endTime - Event end datetime
 * @param {Array<string>} params.attendees - Attendee email list
 * @param {number} params.userId - System user ID
 * @returns {Promise<{eventId: string, meetUrl: string, htmlLink: string}>}
 */
export const createGoogleMeetMeeting = async ({
  tenantDb,
  title,
  description,
  startTime,
  endTime,
  attendees,
  userId,
}) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) {
    throw new Error("No connected Google Calendar integration found for this user.");
  }

  // Auto replenish token if expired
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  // Load tenant-specific Google OAuth config if available
  let tenantGoogleConfig = null;
  try {
    const platformDb = (await import("../../../../models/index.js")).default;
    const orgId = connection.organisation_id;
    if (orgId) {
      const org = await platformDb.Organisation.findByPk(orgId, { attributes: ["id", "smtp_settings"] });
      const raw = org?.smtp_settings || {};
      tenantGoogleConfig = raw?.google || raw?.integrations?.google || null;
    }
  } catch (readErr) {
    logger.warn({ err: readErr }, "Failed to read organisation settings for Google meeting creation");
  }

  const oauth2Client = getOAuth2Client(tenantGoogleConfig);
  if (!oauth2Client) throw new Error("Google OAuth client not configured for this tenant.");
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // Format attendees for Calendar API
  const formattedAttendees = Array.isArray(attendees)
    ? attendees.map((email) => ({ email }))
    : [];

  const eventPayload = {
    summary: title,
    description: description || "",
    start: {
      dateTime: new Date(startTime).toISOString(),
      timeZone: "UTC",
    },
    end: {
      dateTime: new Date(endTime).toISOString(),
      timeZone: "UTC",
    },
    attendees: formattedAttendees,
    conferenceData: {
      createRequest: {
        requestId: uuidv4(),
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    },
  };

  try {
    logger.info({ userId }, "Creating Google Calendar event with hangoutsMeet solution");
    
    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: eventPayload,
      conferenceDataVersion: 1, // Crucial: triggers meet url generation
      // Without this Google defaults to sendUpdates:"none" and silently skips
      // the invitation emails, so attendees never receive the Meet link.
      sendUpdates: "all",
    });

    const eventData = response.data;
    const eventId = eventData.id;
    const htmlLink = eventData.htmlLink;
    let meetUrl = null;

    if (eventData.conferenceData && Array.isArray(eventData.conferenceData.entryPoints)) {
      const videoEntryPoint = eventData.conferenceData.entryPoints.find(
        (ep) => ep.entryPointType === "video"
      );
      if (videoEntryPoint) {
        meetUrl = videoEntryPoint.uri;
      }
    }

    // Fallback if meet link wasn't immediately created by Google
    if (!meetUrl && eventData.hangoutLink) {
      meetUrl = eventData.hangoutLink;
    }

    return {
      eventId,
      meetUrl: meetUrl || "",
      htmlLink: htmlLink || "",
    };
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to create meeting on Google Calendar");
    throw new Error("Google Calendar API error: " + (error.message || error));
  }
};

/**
 * Updates a Google Calendar event.
 */
export const updateGoogleCalendarEvent = async ({ tenantDb, userId, eventId, title, description, startTime, endTime, attendees = [] }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return null;
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  let tenantGoogleConfig = null;
  try {
    const platformDb = (await import("../../../../models/index.js")).default;
    const org = await platformDb.Organisation.findByPk(connection.organisation_id, { attributes: ["smtp_settings"] });
    tenantGoogleConfig = org?.smtp_settings?.google || org?.smtp_settings?.integrations?.google || null;
  } catch (err) {
    logger.warn({ err }, "Failed to load tenant Google config; falling back to defaults");
  }

  const oauth2Client = getOAuth2Client(tenantGoogleConfig);
  if (!oauth2Client) throw new Error("Google OAuth client not configured.");
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const formattedAttendees = Array.isArray(attendees) ? attendees.map((email) => ({ email })) : [];

  const eventPayload = {
    summary: title,
    description: description || "",
    start: { dateTime: new Date(startTime).toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(endTime).toISOString(), timeZone: "UTC" },
    attendees: formattedAttendees,
  };

  try {
    const response = await calendar.events.patch({
      calendarId: "primary",
      eventId,
      resource: eventPayload,
      sendUpdates: "all",
    });
    return response.data;
  } catch (error) {
    throw new Error("Google Calendar API error: " + (error.message || error));
  }
};

/**
 * Cancels a Google Calendar event (alias for delete).
 */
export const cancelGoogleCalendarEvent = async (params) => deleteGoogleCalendarEvent(params);

/**
 * Deletes a Google Calendar event.
 */
export const deleteGoogleCalendarEvent = async ({ tenantDb, userId, eventId }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return null;
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  let tenantGoogleConfig = null;
  try {
    const platformDb = (await import("../../../../models/index.js")).default;
    const org = await platformDb.Organisation.findByPk(connection.organisation_id, { attributes: ["smtp_settings"] });
    tenantGoogleConfig = org?.smtp_settings?.google || org?.smtp_settings?.integrations?.google || null;
  } catch (err) {
    logger.warn({ err }, "Failed to load tenant Google config; falling back to defaults");
  }

  const oauth2Client = getOAuth2Client(tenantGoogleConfig);
  if (!oauth2Client) throw new Error("Google OAuth client not configured.");
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
    });
    return true;
  } catch (error) {
    if (error.code === 404 || error.response?.status === 404) return true;
    throw new Error("Google Calendar API error: " + (error.message || error));
  }
};

/**
 * Lists the user's Google Calendar events in a window.
 *
 * `singleEvents: true` expands recurring series into individual occurrences,
 * which is what a calendar grid needs — without it a weekly meeting appears
 * once, on the date the series was created.
 */
export const listGoogleCalendarEvents = async ({ tenantDb, userId, startTime, endTime, maxPages = 5 }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return [];

  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  let tenantGoogleConfig = null;
  try {
    const platformDb = (await import("../../../../models/index.js")).default;
    const org = await platformDb.Organisation.findByPk(connection.organisation_id, { attributes: ["smtp_settings"] });
    tenantGoogleConfig = org?.smtp_settings?.google || org?.smtp_settings?.integrations?.google || null;
  } catch (err) {
    logger.warn({ err }, "Failed to load tenant Google config; falling back to defaults");
  }

  const oauth2Client = getOAuth2Client(tenantGoogleConfig);
  if (!oauth2Client) throw new Error("Google OAuth client not configured.");
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const events = [];
  let pageToken;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date(startTime).toISOString(),
      timeMax: new Date(endTime).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      showDeleted: false,
      pageToken,
    });

    for (const item of response.data.items || []) {
      // All-day events carry `date` (YYYY-MM-DD) instead of `dateTime`.
      const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
      const rawStart = item.start?.dateTime || item.start?.date;
      const rawEnd = item.end?.dateTime || item.end?.date;
      if (!rawStart || !rawEnd) continue;

      const start = new Date(rawStart);
      const end = new Date(rawEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      let joinUrl = item.hangoutLink || null;
      if (!joinUrl && Array.isArray(item.conferenceData?.entryPoints)) {
        joinUrl = item.conferenceData.entryPoints.find((ep) => ep.entryPointType === "video")?.uri || null;
      }

      events.push({
        externalId: item.id,
        subject: item.summary || "(No subject)",
        description: item.description || "",
        startTime: start,
        endTime: end,
        location: item.location || "",
        joinUrl,
        attendees: (item.attendees || []).map((a) => a?.email).filter(Boolean),
        organiserEmail: item.organizer?.email || null,
        isCancelled: item.status === "cancelled",
        isAllDay,
        webLink: item.htmlLink || null,
      });
    }

    pageToken = response.data.nextPageToken;
    if (!pageToken) break;
  }

  logger.info({ userId, count: events.length }, "Fetched Google Calendar events");
  return events;
};
