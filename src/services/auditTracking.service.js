import logger from '../utils/logger.js';
import { recordTimelineEntry } from './caseTimeline.service.js';
import { notifyUser, NotificationTypes, NotificationPriority } from './notification.service.js';

/**
 * Compares before/after values and creates granular AuditLog and Timeline entries.
 * Can be called manually or from Sequelize hooks.
 */
export async function trackFieldChanges(instance, options = {}) {
  try {
    const sequelize = instance.sequelize;
    const AuditLog = sequelize.models.AuditLog;
    if (!AuditLog) return;

    // We can extract performedBy from options if passed during .update(..., { performedBy: userId })
    const performedBy = options.performedBy || 1;
    const role = options.role || 'system';
    const ipAddress = options.ipAddress || null;
    const userAgent = options.userAgent || null;
    const organisationId = options.organisationId || instance.organisation_id || null;
    
    // In multi-tenant, model name helps us know what we are tracking
    const entityType = instance.constructor.name; 
    const entityId = String(instance.id);

    const changes = instance.changed();
    if (!changes || changes.length === 0) return;

    // We want to generate human-readable strings for timeline
    let timelineDescriptions = [];

    for (const field of changes) {
      // Ignore internal Sequelize tracking fields
      if (['updated_at', 'updatedAt', 'created_at', 'createdAt'].includes(field)) continue;

      const oldValue = instance.previous(field);
      const newValue = instance.getDataValue(field);

      // Create granular Audit Log
      await AuditLog.create({
        user_id: performedBy,
        action: `UPDATE_FIELD`,
        resource: entityId,
        entity_type: entityType,
        entity_id: entityId,
        field_name: field,
        old_value: oldValue !== undefined ? oldValue : null,
        new_value: newValue !== undefined ? newValue : null,
        role: role,
        ip_address: ipAddress,
        user_agent: userAgent,
        organisation_id: organisationId,
        status: 'Success',
        details: `Field '${field}' updated on ${entityType} ${entityId}`
      }, { transaction: options.transaction });

      // Build human readable sentence for timeline
      // Example: "Candidate Passport Number changed from AB123456 to AB987654"
      const readableField = field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      const oldStr = (oldValue === null || oldValue === '') ? 'Empty' : String(oldValue);
      const newStr = (newValue === null || newValue === '') ? 'Empty' : String(newValue);
      
      timelineDescriptions.push(`${entityType} ${readableField} changed from ${oldStr} to ${newStr}`);
    }

    // specific handling for Candidate profiles (CandidateApplication or User)
    if (timelineDescriptions.length > 0 && (entityType === 'CandidateApplication' || entityType === 'User')) {
      const Case = sequelize.models.Case;
      const caseRecord = Case ? await Case.findOne({ 
        where: { candidateId: entityType === 'CandidateApplication' ? instance.userId : instance.id }
      }) : null;

      if (caseRecord) {
        for (const desc of timelineDescriptions) {
          await recordTimelineEntry({
            tenantDb: { CaseTimeline: sequelize.models.CaseTimeline }, // mock tenantDb interface for recordTimelineEntry
            caseId: caseRecord.id,
            actionType: 'case_updated',
            description: desc,
            performedBy,
            visibility: 'public' // or internal based on field
          });
        }

        // Notify Caseworker and OrgAdmin
        const notifyTargets = [];
        
        // 1. Assigned Caseworker
        if (caseRecord.assignedCaseworkerId) {
          const cwIds = Array.isArray(caseRecord.assignedCaseworkerId) 
            ? caseRecord.assignedCaseworkerId 
            : [caseRecord.assignedCaseworkerId];
          notifyTargets.push(...cwIds);
        }
        
        // 2. Org Admin (role_id 2 typically)
        const User = sequelize.models.User;
        if (User && organisationId) {
          const admins = await User.findAll({ where: { role_id: 2, organisation_id: organisationId } });
          notifyTargets.push(...admins.map(a => a.id));
        }

        // Filter out the actor ("Never Notify Actor")
        const uniqueTargets = [...new Set(notifyTargets)].filter(id => String(id) !== String(performedBy));

        for (const targetId of uniqueTargets) {
          await notifyUser({ Notification: sequelize.models.Notification }, targetId, {
            type: NotificationTypes.INFO,
            priority: NotificationPriority.MEDIUM,
            title: `Candidate Data Updated`,
            message: `${timelineDescriptions.join('. ')}`,
            actionType: 'candidate_update',
            entityId: caseRecord.id,
            entityType: 'case'
          });
        }
      }
    }

  } catch (error) {
    logger.error({ err: error }, 'auditTracking.service: Failed to track field changes');
  }
}
