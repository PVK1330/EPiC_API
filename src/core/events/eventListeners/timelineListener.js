import eventBus from '../eventBus.js';
import { EVENTS } from '../eventRegistry.js';
import { generateNotification } from '../../../services/notification.service.js';
import { recordTimelineEntry } from '../../../services/caseTimeline.service.js';
import { logAuditActivity } from '../../../services/auditLogger.service.js';
import logger from '../../../utils/logger.js';
import { Op } from 'sequelize';

/**
 * Handles Timeline -> Notification Integration (Phase 13)
 * Provides the 5-step pipeline: Timeline -> Audit -> Notification -> Socket -> Email
 */

const setupTimelineIntegration = () => {
  // Listen to all business events that are timeline-relevant
  const TIMELINE_EVENTS = [
    EVENTS.PROFILE_UPDATED,
    EVENTS.DOCUMENT_UPLOADED,
    EVENTS.DOCUMENT_APPROVED,
    EVENTS.DOCUMENT_REJECTED,
    EVENTS.CASE_STATUS_CHANGED,
    EVENTS.CHANGE_REQUEST_SUBMITTED,
    EVENTS.APPOINTMENT_UPDATED,
    EVENTS.APPOINTMENT_SCHEDULED
  ];

  TIMELINE_EVENTS.forEach(eventName => {
    eventBus.on(eventName, async (payload) => {
      try {
        const { __context, entityId, entityType, performedById, performedByRole, oldValue, newValue, actionType, description, templateCode } = payload;
        const { tenantDb, io, organisationId } = __context;

        if (!tenantDb || !entityId) return;

        // 1. Create Timeline Entry
        await recordTimelineEntry({
          tenantDb,
          caseId: entityType === 'case' ? entityId : (payload.caseId || null),
          userId: performedById,
          actionType: actionType || eventName,
          description: description || `Event ${eventName} triggered`,
          oldValue,
          newValue
        });

        // 2. Create Audit Log
        if (logAuditActivity) {
          await logAuditActivity(tenantDb, {
            userId: performedById,
            action: eventName,
            entityType,
            entityId,
            details: { oldValue, newValue }
          });
        }

        // Determine Notification Targets based on Rules
        // Target 1: Candidates
        // Target 2: Caseworkers
        // Target 3: Org Admins
        let notifyCandidate = false;
        let notifyCaseworker = false;
        let notifyAdmin = false;

        const role = String(performedByRole).toLowerCase();
        if (role === 'candidate') {
          notifyCaseworker = true;
          notifyAdmin = true;
        } else if (role === 'caseworker') {
          notifyCandidate = true;
          notifyAdmin = true;
        } else if (role === 'admin' || role === 'orgadmin') {
          notifyCandidate = true;
          notifyCaseworker = true;
        }

        // Fetch Target User IDs
        let targetUserIds = [];
        
        if (notifyCandidate && payload.candidateId) {
          targetUserIds.push(payload.candidateId);
        }

        if (notifyCaseworker && payload.assignedCaseworkerId) {
          if (Array.isArray(payload.assignedCaseworkerId)) {
            targetUserIds.push(...payload.assignedCaseworkerId);
          } else {
            targetUserIds.push(payload.assignedCaseworkerId);
          }
        }

        if (notifyAdmin) {
          const adminRole = await tenantDb.Role.findOne({ where: { name: { [Op.iLike]: 'admin' } } });
          if (adminRole) {
            const admins = await tenantDb.User.findAll({
              where: { role_id: adminRole.id, status: 'active' },
              attributes: ['id']
            });
            targetUserIds.push(...admins.map(a => a.id));
          }
        }

        // Remove duplicates and exclude the user who performed the action (Rule 1)
        targetUserIds = [...new Set(targetUserIds)].filter(id => id !== performedById);

        // Priority Checks
        let priority = 'low';
        let category = 'case';
        if (eventName === EVENTS.CHANGE_REQUEST_SUBMITTED || eventName === EVENTS.DOCUMENT_REJECTED) {
          priority = 'high';
        }
        if (eventName.includes('DOCUMENT')) category = 'document';
        if (eventName.includes('APPOINTMENT')) category = 'appointment';

        // 3, 4, 5. Generate Notification (handles Socket & Email internally)
        for (const recipientId of targetUserIds) {
          await generateNotification({ tenantDb, io }, {
            templateCode: templateCode || eventName,
            recipientId,
            organisationId,
            entityType,
            entityId,
            category,
            priority,
            type: eventName.includes('REJECTED') ? 'error' : 'info',
            templateData: { description, oldValue, newValue }
          });
        }

        // 6. Emit specific socket events
        if (io) {
          const caseId = entityType === 'case' ? entityId : payload.caseId;
          if (caseId) {
            io.emit(`timeline:update:${caseId}`, { eventName, entityId, oldValue, newValue });
            io.emit(`case:update:${caseId}`, { eventName, entityId, oldValue, newValue });
          }
        }

      } catch (err) {
        logger.error({ err, eventName }, 'Error processing timeline integration listener');
      }
    });
  });
};

export default setupTimelineIntegration;
