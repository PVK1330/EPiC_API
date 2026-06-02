// Microsoft Workflow Integration Service
import logger from "../../../../utils/logger.js";
import { createTeamsOnlineMeeting, cancelTeamsOnlineMeeting, updateTeamsOnlineMeeting, createOutlookCalendarEvent, updateOutlookCalendarEvent, deleteOutlookCalendarEvent } from "./microsoftMeeting.service.js";
import { getConnection } from "./microsoft.service.js";

/**
 * Triggered after an appointment is successfully created.
 * Synchronizes to Microsoft Teams & Outlook Calendar asynchronously.
 */
export const syncAppointmentToMicrosoft = async (tenantDb, appointment, candidate, staffMembers) => {
  try {
    // Determine the host (typically the primary caseworker)
    const hostId = appointment.caseworker_id;
    if (!hostId) return;

    const connection = await getConnection(tenantDb, hostId);
    if (!connection || !connection.is_active) return; // Microsoft not connected

    logger.info({ appointmentId: appointment.id }, "Starting async Microsoft sync for new appointment");

    // Start sync process asynchronously (fire and forget from controller perspective)
    processSync(tenantDb, hostId, appointment, candidate, staffMembers).catch(err => {
      logger.error({ err }, "Unhandled error in Microsoft sync process");
    });

  } catch (error) {
    logger.error({ err: error }, "Failed to initiate Microsoft sync");
  }
};

const processSync = async (tenantDb, hostId, appointment, candidate, staffMembers) => {
  let teamsMeetingId = null;
  let teamsJoinUrl = null;
  let outlookEventId = null;

  try {
    const attendees = staffMembers.map(s => s.email);
    if (candidate && candidate.email) {
      attendees.push(candidate.email);
    }

    const title = appointment.title || "EPiC Meeting";
    const desc = appointment.description || "";
    // Reconstruct valid dates
    const startDateTime = new Date(`${appointment.date}T${appointment.time}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // assume 1 hour duration

    // 1. Create Teams Meeting
    if (appointment.platform === 'teams' || appointment.platform === 'Microsoft Teams') {
      const teamsRes = await createTeamsOnlineMeeting({
        tenantDb,
        userId: hostId,
        title,
        description: desc,
        startTime: startDateTime,
        endTime: endDateTime
      });
      teamsMeetingId = teamsRes.eventId;
      teamsJoinUrl = teamsRes.meetUrl;

      // Update appointment meeting URL locally
      await appointment.update({ meeting_url: teamsJoinUrl });
    }

    // 2. Create Outlook Calendar Event
    const calendarRes = await createOutlookCalendarEvent({
      tenantDb,
      userId: hostId,
      title,
      description: teamsJoinUrl ? `${desc}\n\nJoin Teams Meeting: ${teamsJoinUrl}` : desc,
      startTime: startDateTime,
      endTime: endDateTime,
      attendees
    });
    outlookEventId = calendarRes.eventId;

    // 3. Save mappings
    if (teamsMeetingId) {
      await tenantDb.MeetingIntegration.create({
        appointment_id: appointment.id,
        provider: 'microsoft_teams',
        provider_meeting_id: teamsMeetingId,
        join_url: teamsJoinUrl,
        status: 'active'
      });
    }

    if (outlookEventId) {
      await tenantDb.MeetingIntegration.create({
        appointment_id: appointment.id,
        provider: 'microsoft_outlook',
        provider_meeting_id: outlookEventId,
        status: 'active'
      });
    }

    // 4. Generate Timelines and Audits
    if (tenantDb.CaseTimeline && appointment.case_id) {
      await tenantDb.CaseTimeline.create({
        case_id: appointment.case_id,
        type: 'APPOINTMENT_SYNCED',
        title: 'Microsoft Calendar Sync',
        description: `Meeting successfully synced to Microsoft Outlook / Teams.`,
        icon: 'calendar',
        created_by: hostId,
      }).catch(() => {});
    }

    await tenantDb.AuditLog.create({
      user_id: hostId,
      action: 'MICROSOFT_CALENDAR_EVENT_CREATED',
      details: `Synced appointment ID ${appointment.id} to Microsoft.`,
      status: 'Success'
    }).catch(() => {});

  } catch (error) {
    logger.error({ err: error, appointmentId: appointment.id }, "Microsoft sync failed. Queuing for retry.");
    
    // Add to retry queue
    await tenantDb.IntegrationRetryQueue.create({
      user_id: hostId,
      provider: 'microsoft',
      action: 'CREATE_MEETING',
      payload: { appointmentId: appointment.id, candidateId: candidate?.id, staffIds: staffMembers.map(s => s.id) },
      error_reason: error.message,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000) // 5 mins
    });

    await tenantDb.AuditLog.create({
      user_id: hostId,
      action: 'MICROSOFT_SYNC_FAILED',
      details: `Failed to sync appointment ID ${appointment.id}. Queued for retry. Error: ${error.message}`,
      status: 'Failed'
    }).catch(() => {});
  }
};

/**
 * Triggered after an appointment is updated.
 */
export const updateAppointmentInMicrosoft = async (tenantDb, appointment) => {
  try {
    const hostId = appointment.caseworker_id;
    if (!hostId) return;

    processUpdate(tenantDb, hostId, appointment).catch(err => {
      logger.error({ err }, "Unhandled error in Microsoft update sync");
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to initiate Microsoft update sync");
  }
};

const processUpdate = async (tenantDb, hostId, appointment) => {
  try {
    const integrations = await tenantDb.MeetingIntegration.findAll({
      where: { appointment_id: appointment.id, status: 'active' }
    });

    if (!integrations.length) return;

    const title = appointment.title;
    const startDateTime = new Date(`${appointment.date}T${appointment.time}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    for (const integration of integrations) {
      if (integration.provider === 'microsoft_teams') {
        await updateTeamsOnlineMeeting({
          tenantDb,
          userId: hostId,
          meetingId: integration.provider_meeting_id,
          title,
          startTime: startDateTime,
          endTime: endDateTime
        });
      } else if (integration.provider === 'microsoft_outlook') {
        await updateOutlookCalendarEvent({
          tenantDb,
          userId: hostId,
          eventId: integration.provider_meeting_id,
          title,
          startTime: startDateTime,
          endTime: endDateTime
        });
      }
    }
  } catch (error) {
    logger.error({ err: error, appointmentId: appointment.id }, "Microsoft update sync failed.");
    await tenantDb.IntegrationRetryQueue.create({
      user_id: hostId,
      provider: 'microsoft',
      action: 'UPDATE_MEETING',
      payload: { appointmentId: appointment.id },
      error_reason: error.message,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000)
    });
  }
};

/**
 * Triggered after an appointment is cancelled.
 */
export const cancelAppointmentInMicrosoft = async (tenantDb, hostId, appointmentId) => {
  try {
    if (!hostId) return;
    
    processCancel(tenantDb, hostId, appointmentId).catch(err => {
      logger.error({ err }, "Unhandled error in Microsoft cancel sync");
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to initiate Microsoft cancel sync");
  }
};

const processCancel = async (tenantDb, hostId, appointmentId) => {
  try {
    const integrations = await tenantDb.MeetingIntegration.findAll({
      where: { appointment_id: appointmentId, status: 'active' }
    });

    for (const integration of integrations) {
      if (integration.provider === 'microsoft_teams') {
        await cancelTeamsOnlineMeeting({ tenantDb, userId: hostId, meetingId: integration.provider_meeting_id }).catch(() => {});
      } else if (integration.provider === 'microsoft_outlook') {
        await deleteOutlookCalendarEvent({ tenantDb, userId: hostId, eventId: integration.provider_meeting_id }).catch(() => {});
      }
      await integration.update({ status: 'cancelled' });
    }
  } catch (error) {
    logger.error({ err: error, appointmentId }, "Microsoft cancel sync failed.");
    await tenantDb.IntegrationRetryQueue.create({
      user_id: hostId,
      provider: 'microsoft',
      action: 'CANCEL_MEETING',
      payload: { appointmentId },
      error_reason: error.message,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000)
    });
  }
};
