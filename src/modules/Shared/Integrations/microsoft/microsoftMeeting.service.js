// Microsoft Meeting Service
// Created at: 2026-05-29

import { getOrRefreshAccessToken } from "./microsoftToken.service.js";
import { getConnection } from "./microsoft.service.js";
import logger from "../../../../utils/logger.js";

/**
 * Schedules an Online Meeting in Microsoft Teams via Microsoft Graph API.
 * 
 * @param {object} params
 * @param {object} params.tenantDb - Tenant database context
 * @param {string} params.title - Event subject
 * @param {string} params.description - Event agenda body
 * @param {string|Date} params.startTime - Event start datetime
 * @param {string|Date} params.endTime - Event end datetime
 * @param {number} params.userId - System user ID
 * @returns {Promise<{eventId: string, meetUrl: string, htmlLink: string}>}
 */
export const createTeamsOnlineMeeting = async ({
  tenantDb,
  title,
  description,
  startTime,
  endTime,
  userId,
}) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) {
    throw new Error("No connected Microsoft 365 calendar integration found for this user.");
  }

  // Assert valid access token
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const url = "https://graph.microsoft.com/v1.0/me/onlineMeetings";

  const payload = {
    subject: title,
    startDateTime: new Date(startTime).toISOString(),
    endDateTime: new Date(endTime).toISOString(),
    lobbyBypassSettings: {
      scope: "everyone",
    },
  };

  try {
    logger.info({ userId }, "Creating Microsoft Graph Online Meeting");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Microsoft Graph API returned ${response.status}: ${errorBody}`);
    }

    const meetingData = await response.json();
    
    return {
      eventId: meetingData.id,
      meetUrl: meetingData.joinWebUrl,
      htmlLink: meetingData.joinWebUrl,
    };
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to create Teams Online Meeting");
    throw new Error("Microsoft Graph API error: " + (error.message || error));
  }
};

/**
 * Updates a Microsoft Teams Meeting.
 */
export const updateTeamsOnlineMeeting = async ({ tenantDb, userId, meetingId, title, startTime, endTime }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return null;
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}`;
  const payload = {
    subject: title,
    startDateTime: new Date(startTime).toISOString(),
    endDateTime: new Date(endTime).toISOString(),
  };

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to update Teams Meeting: ${await response.text()}`);
  }

  return await response.json();
};

/**
 * Deletes a Microsoft Teams Meeting.
 */
export const cancelTeamsOnlineMeeting = async ({ tenantDb, userId, meetingId }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return null;
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const url = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete Teams Meeting: ${await response.text()}`);
  }

  return true;
};

/**
 * Creates an Outlook Calendar Event.
 */
export const createOutlookCalendarEvent = async ({ tenantDb, userId, title, description, startTime, endTime, attendees = [] }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) throw new Error("No connected Microsoft 365 calendar integration found.");
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const url = "https://graph.microsoft.com/v1.0/me/events";
  
  const payload = {
    subject: title,
    body: {
      contentType: "HTML",
      content: description || "",
    },
    start: {
      dateTime: new Date(startTime).toISOString(),
      timeZone: "UTC",
    },
    end: {
      dateTime: new Date(endTime).toISOString(),
      timeZone: "UTC",
    },
    attendees: attendees.map(email => ({
      emailAddress: { address: email },
      type: "required",
    })),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to create Outlook Calendar Event: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    eventId: data.id,
    meetUrl: data.onlineMeeting?.joinUrl || null,
    htmlLink: data.webLink,
  };
};

/**
 * Updates an Outlook Calendar Event.
 */
export const updateOutlookCalendarEvent = async ({ tenantDb, userId, eventId, title, startTime, endTime }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return null;
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const url = `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
  const payload = {
    subject: title,
    start: { dateTime: new Date(startTime).toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(endTime).toISOString(), timeZone: "UTC" },
  };

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to update Outlook Calendar Event: ${await response.text()}`);
  }
  return await response.json();
};

/**
 * Deletes an Outlook Calendar Event.
 */
export const deleteOutlookCalendarEvent = async ({ tenantDb, userId, eventId }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return null;
  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const url = `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete Outlook Calendar Event: ${await response.text()}`);
  }
  return true;
};

/**
 * Creates a Teams meeting AS A CALENDAR EVENT (not a bare online meeting).
 *
 * `POST /me/onlineMeetings` — what createTeamsOnlineMeeting above uses — mints a
 * join link but no calendar entry and no invitations: nothing appears in Outlook
 * or Teams, and attendees are never told. `POST /me/events` with
 * `isOnlineMeeting` does all three in one call: the event lands on the
 * organiser's calendar (so it syncs back to us), Graph generates the Teams link,
 * and Exchange emails the invite to every attendee.
 */
export const createTeamsCalendarMeeting = async ({
  tenantDb,
  userId,
  title,
  description,
  startTime,
  endTime,
  attendees = [],
  location = "Microsoft Teams",
}) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) {
    throw new Error("No connected Microsoft 365 calendar integration found for this user.");
  }

  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const payload = {
    subject: title,
    body: { contentType: "HTML", content: description || "" },
    start: { dateTime: new Date(startTime).toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(endTime).toISOString(), timeZone: "UTC" },
    location: { displayName: location || "Microsoft Teams" },
    attendees: (attendees || [])
      .filter(Boolean)
      .map((email) => ({ emailAddress: { address: email }, type: "required" })),
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    allowNewTimeProposals: false,
  };

  const response = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ userId, status: response.status, errorBody }, "Failed to create Teams calendar event");
    throw new Error(`Microsoft Graph API returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return {
    eventId: data.id,
    meetUrl: data.onlineMeeting?.joinUrl || null,
    htmlLink: data.webLink || null,
  };
};

// Graph returns `start.dateTime` WITHOUT a trailing Z even when the response is
// UTC (the timezone travels in the `Prefer` header / `start.timeZone` instead),
// so `new Date(value)` would read it as local time and shift the meeting.
const toUtcDate = (value, timeZone) => {
  if (!value) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const isUtcZone = !timeZone || /^utc$/i.test(timeZone);
  const normalised = hasOffset || !isUtcZone ? value : `${value}Z`;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Lists the user's Outlook/Teams calendar events in a window.
 *
 * Uses /me/calendarView rather than /me/events so recurring series are expanded
 * into their individual occurrences — otherwise a weekly stand-up shows up once,
 * on the date the series was created.
 */
export const listOutlookCalendarEvents = async ({ tenantDb, userId, startTime, endTime, maxPages = 5 }) => {
  const connection = await getConnection(tenantDb, userId);
  if (!connection) return [];

  const accessToken = await getOrRefreshAccessToken(tenantDb, connection);

  const params = new URLSearchParams({
    startDateTime: new Date(startTime).toISOString(),
    endDateTime: new Date(endTime).toISOString(),
    $select: "id,subject,bodyPreview,start,end,location,attendees,onlineMeeting,isCancelled,isAllDay,webLink,organizer",
    $orderby: "start/dateTime",
    $top: "200",
  });

  let url = `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;
  const events = [];

  for (let page = 0; page < maxPages && url; page += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Microsoft Graph calendarView returned ${response.status}: ${errorBody}`);
    }

    const body = await response.json();
    for (const item of body.value || []) {
      const start = toUtcDate(item.start?.dateTime, item.start?.timeZone);
      const end = toUtcDate(item.end?.dateTime, item.end?.timeZone);
      if (!start || !end) continue;

      events.push({
        externalId: item.id,
        subject: item.subject || "(No subject)",
        description: item.bodyPreview || "",
        startTime: start,
        endTime: end,
        location: item.location?.displayName || "",
        joinUrl: item.onlineMeeting?.joinUrl || null,
        attendees: (item.attendees || [])
          .map((a) => a?.emailAddress?.address)
          .filter(Boolean),
        organiserEmail: item.organizer?.emailAddress?.address || null,
        isCancelled: Boolean(item.isCancelled),
        isAllDay: Boolean(item.isAllDay),
        webLink: item.webLink || null,
      });
    }

    url = body["@odata.nextLink"] || null;
  }

  logger.info({ userId, count: events.length }, "Fetched Outlook calendar events");
  return events;
};
