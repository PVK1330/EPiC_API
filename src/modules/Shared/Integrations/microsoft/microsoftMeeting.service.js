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
