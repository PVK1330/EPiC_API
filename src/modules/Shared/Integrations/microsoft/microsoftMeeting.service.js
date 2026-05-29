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
  const accessToken = await getOrRefreshAccessToken(connection);

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
