// Google Workflow Integration Service
import logger from "../../../../utils/logger.js";
import { createGoogleMeetMeeting, cancelGoogleCalendarEvent, updateGoogleCalendarEvent, deleteGoogleCalendarEvent } from "./googleMeeting.service.js";
import { getConnection } from "./google.service.js";

/**
 * Triggered after an appointment is successfully created.
 * Synchronizes to Google Calendar & Meet asynchronously.
 */
export const syncAppointmentToGoogle = async (tenantDb, appointment, candidate, staffMembers) => {
  try {
    const hostId = appointment.caseworker_id;
    if (!hostId) return;

    const connection = await getConnection(tenantDb, hostId);
    if (!connection || !connection.is_active) return; // Google not connected

    logger.info({ appointmentId: appointment.id }, "Starting async Google sync for new appointment");

    // Start sync process asynchronously (fire and forget)
    processSync(tenantDb, hostId, appointment, candidate, staffMembers).catch(err => {
      logger.error({ err }, "Unhandled error in Google sync process");
    });

  } catch (error) {
    logger.error({ err: error }, "Failed to initiate Google sync");
  }
};

const processSync = async (tenantDb, hostId, appointment, candidate, staffMembers) => {
  try {
    const attendees = staffMembers.map(s => s.email);
    if (candidate && candidate.email) {
      attendees.push(candidate.email);
    }

    const title = appointment.title || "EPiC Meeting";
    const desc = appointment.description || "";
    const startDateTime = new Date(`${appointment.date}T${appointment.time}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); 

    const isGooglePlatform = appointment.platform === 'google' || appointment.platform === 'Google Meet';

    // 1. Create Google Calendar Event (and Meet if specified)
    const calendarRes = await createGoogleMeetMeeting({
      tenantDb,
      userId: hostId,
      title,
      description: desc,
      startTime: startDateTime,
      endTime: endDateTime,
      attendees
    });

    const googleEventId = calendarRes.eventId;
    let meetUrl = null;

    if (isGooglePlatform && calendarRes.meetUrl) {
      meetUrl = calendarRes.meetUrl;
      await appointment.update({ meeting_url: meetUrl });
    }

    // 2. Save mappings
    if (googleEventId) {
      await tenantDb.MeetingIntegration.create({
        appointment_id: appointment.id,
        provider: 'google',
        provider_calendar_event_id: googleEventId,
        provider_meeting_id: googleEventId, 
        join_url: meetUrl,
        status: 'active',
        sync_status: 'SYNCED'
      });
    }

    // 3. Generate Timelines and Audits
    if (tenantDb.CaseTimeline && appointment.case_id) {
      await tenantDb.CaseTimeline.create({
        case_id: appointment.case_id,
        type: 'APPOINTMENT_SYNCED',
        title: 'Google Calendar Sync',
        description: `Meeting successfully synced to Google Calendar / Meet.`,
        icon: 'calendar',
        created_by: hostId,
      }).catch(() => {});
    }

    await tenantDb.AuditLog.create({
      user_id: hostId,
      action: 'GOOGLE_EVENT_CREATED',
      details: `Synced appointment ID ${appointment.id} to Google.`,
      status: 'Success'
    }).catch(() => {});

  } catch (error) {
    logger.error({ err: error, appointmentId: appointment.id }, "Google sync failed. Queuing for retry.");
    
    // Add to retry queue
    await tenantDb.IntegrationRetryQueue.create({
      user_id: hostId,
      provider: 'google',
      action: 'CREATE_MEETING',
      payload: { appointmentId: appointment.id, candidateId: candidate?.id, staffIds: staffMembers.map(s => s.id) },
      error_reason: error.message,
      next_retry_at: new Date(Date.now() + 1 * 60 * 1000) // 1 min backoff
    });

    await tenantDb.AuditLog.create({
      user_id: hostId,
      action: 'GOOGLE_SYNC_FAILED',
      details: `Failed to sync appointment ID ${appointment.id}. Queued for retry. Error: ${error.message}`,
      status: 'Failed'
    }).catch(() => {});
  }
};

/**
 * Triggered after an appointment is updated.
 */
export const updateAppointmentInGoogle = async (tenantDb, appointment) => {
  try {
    const hostId = appointment.caseworker_id;
    if (!hostId) return;

    processUpdate(tenantDb, hostId, appointment).catch(err => {
      logger.error({ err }, "Unhandled error in Google update sync");
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to initiate Google update sync");
  }
};

const processUpdate = async (tenantDb, hostId, appointment) => {
  try {
    const integrations = await tenantDb.MeetingIntegration.findAll({
      where: { appointment_id: appointment.id, status: 'active', provider: 'google' }
    });

    if (!integrations.length) return;

    const title = appointment.title;
    const startDateTime = new Date(`${appointment.date}T${appointment.time}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    for (const integration of integrations) {
      await updateGoogleCalendarEvent({
        tenantDb,
        userId: hostId,
        eventId: integration.provider_calendar_event_id || integration.provider_meeting_id,
        title,
        startTime: startDateTime,
        endTime: endDateTime
      });
    }
  } catch (error) {
    logger.error({ err: error, appointmentId: appointment.id }, "Google update sync failed.");
    await tenantDb.IntegrationRetryQueue.create({
      user_id: hostId,
      provider: 'google',
      action: 'UPDATE_MEETING',
      payload: { appointmentId: appointment.id },
      error_reason: error.message,
      next_retry_at: new Date(Date.now() + 1 * 60 * 1000)
    });
  }
};

/**
 * Triggered after an appointment is cancelled.
 */
export const cancelAppointmentInGoogle = async (tenantDb, hostId, appointmentId) => {
  try {
    if (!hostId) return;
    
    processCancel(tenantDb, hostId, appointmentId).catch(err => {
      logger.error({ err }, "Unhandled error in Google cancel sync");
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to initiate Google cancel sync");
  }
};

const processCancel = async (tenantDb, hostId, appointmentId) => {
  try {
    const integrations = await tenantDb.MeetingIntegration.findAll({
      where: { appointment_id: appointmentId, status: 'active', provider: 'google' }
    });

    for (const integration of integrations) {
      await deleteGoogleCalendarEvent({ 
        tenantDb, 
        userId: hostId, 
        eventId: integration.provider_calendar_event_id || integration.provider_meeting_id 
      }).catch(() => {});
      await integration.update({ status: 'cancelled' });
    }
  } catch (error) {
    logger.error({ err: error, appointmentId }, "Google cancel sync failed.");
    await tenantDb.IntegrationRetryQueue.create({
      user_id: hostId,
      provider: 'google',
      action: 'CANCEL_MEETING',
      payload: { appointmentId },
      error_reason: error.message,
      next_retry_at: new Date(Date.now() + 1 * 60 * 1000)
    });
  }
};
