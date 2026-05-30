import logger from '../../../utils/logger.js';
import { recordTimelineEntry } from '../../../services/caseTimeline.service.js';
import { notifyUser, NotificationTypes, NotificationPriority } from '../../../services/notification.service.js';
import { emitToUser, EVENT_TYPES } from '../../../realtime/messagingRealtime.js';

// Helper to resolve entity model
function resolveEntityModel(tenantDb, entityType) {
  const modelMap = {
    'Candidate': tenantDb.User,
    'Sponsor': tenantDb.User, // Or SponsorProfile
    'User': tenantDb.User,
    'Organisation': tenantDb.Organisation,
    'CandidateApplication': tenantDb.CandidateApplication,
    'SponsorProfile': tenantDb.SponsorProfile,
    'LicenceApplication': tenantDb.LicenceApplication
  };
  return modelMap[entityType] || null;
}

const addHistory = async (tenantDb, changeRequestId, action, performedBy, role, notes = null) => {
  await tenantDb.ChangeRequestHistory.create({
    change_request_id: changeRequestId,
    action,
    performed_by: performedBy,
    role,
    notes
  });
};

export const createRequest = async (req, res) => {
  try {
    const { entityType, entityId, fieldName, requestedValue, reason, changeCategory, riskLevel, caseId } = req.validated.body;
    const submittedBy = req.user.id;
    const role = req.user.role?.name || 'Candidate';
    const organisationId = req.user.organisation_id || null;

    // Resolve current value if possible
    let oldValue = null;
    const Model = resolveEntityModel(req.tenantDb, entityType);
    if (Model) {
      const record = await Model.findByPk(entityId);
      if (record) {
        oldValue = record.getDataValue(fieldName) || null;
      }
    }

    const cr = await req.tenantDb.ChangeRequest.create({
      entity_type: entityType,
      entity_id: String(entityId),
      case_id: caseId || null,
      field_name: fieldName,
      old_value: oldValue,
      requested_value: requestedValue,
      reason,
      change_category: changeCategory,
      risk_level: riskLevel,
      status: 'SUBMITTED',
      submitted_by: submittedBy,
      organisation_id: organisationId
    });

    await addHistory(req.tenantDb, cr.id, 'SUBMITTED', submittedBy, role, reason);

    // 1. Timeline Entry
    const readableField = fieldName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    if (caseId) {
      await recordTimelineEntry({
        tenantDb: req.tenantDb,
        caseId: caseId,
        actionType: 'status_changed',
        description: `Candidate requested ${readableField} change`,
        performedBy: submittedBy,
        visibility: 'public'
      });
    }

    // 2. Notifications to Caseworker & Admin
    const notifyTargets = [];
    if (caseId) {
      const caseRecord = await req.tenantDb.Case.findByPk(caseId);
      if (caseRecord && caseRecord.assignedCaseworkerId) {
        const cwIds = Array.isArray(caseRecord.assignedCaseworkerId) ? caseRecord.assignedCaseworkerId : [caseRecord.assignedCaseworkerId];
        notifyTargets.push(...cwIds);
      }
    }
    
    if (organisationId) {
      const admins = await req.tenantDb.User.findAll({ where: { role_id: 2, organisation_id: organisationId } });
      notifyTargets.push(...admins.map(a => a.id));
    }

    const uniqueTargets = [...new Set(notifyTargets)].filter(id => String(id) !== String(submittedBy));
    
    for (const targetId of uniqueTargets) {
      await notifyUser(req.tenantDb, targetId, {
        type: NotificationTypes.INFO,
        priority: NotificationPriority.MEDIUM,
        title: `New Change Request: ${changeCategory}`,
        message: `A new change request for ${readableField} has been submitted.`,
        actionType: 'change_request_submitted',
        entityId: cr.id,
        entityType: 'change_request'
      });
      emitToUser(targetId, EVENT_TYPES.NOTIFICATION_NEW, { type: 'change_request', id: cr.id });
    }

    res.status(201).json({ status: 'success', data: cr });
  } catch (error) {
    logger.error({ err: error }, 'Failed to create Change Request');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const listRequests = async (req, res) => {
  try {
    const { status, entityType, riskLevel, caseId, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (entityType) where.entity_type = entityType;
    if (riskLevel) where.risk_level = riskLevel;
    if (caseId) where.case_id = caseId;

    // Role-based filtering
    const userRole = req.user.role?.name;
    if (userRole === 'Candidate' || userRole === 'Sponsor') {
      where.submitted_by = req.user.id;
    } else if (userRole === 'Organisation Admin' || userRole === 'Caseworker') {
      where.organisation_id = req.user.organisation_id;
    }

    const { count, rows } = await req.tenantDb.ChangeRequest.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
      include: [
        { model: req.tenantDb.User, as: 'submitter', attributes: ['id', 'first_name', 'last_name', 'email'] }
      ]
    });

    res.status(200).json({ status: 'success', data: rows, meta: { total: count, page, limit } });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list Change Requests');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getRequestById = async (req, res) => {
  try {
    const cr = await req.tenantDb.ChangeRequest.findByPk(req.params.id, {
      include: [
        { model: req.tenantDb.User, as: 'submitter', attributes: ['id', 'first_name', 'last_name'] },
        { model: req.tenantDb.User, as: 'reviewer', attributes: ['id', 'first_name', 'last_name'] }
      ]
    });
    if (!cr) return res.status(404).json({ status: 'error', message: 'Request not found' });
    res.status(200).json({ status: 'success', data: cr });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get Change Request');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getRequestHistory = async (req, res) => {
  try {
    const history = await req.tenantDb.ChangeRequestHistory.findAll({
      where: { change_request_id: req.params.id },
      order: [['created_at', 'ASC']],
      include: [{ model: req.tenantDb.User, as: 'performer', attributes: ['id', 'first_name', 'last_name'] }]
    });
    res.status(200).json({ status: 'success', data: history });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get Change Request History');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const reviewRequest = async (req, res) => {
  try {
    const cr = await req.tenantDb.ChangeRequest.findByPk(req.params.id);
    if (!cr) return res.status(404).json({ status: 'error', message: 'Request not found' });

    cr.status = 'UNDER_REVIEW';
    cr.reviewed_by = req.user.id;
    await cr.save();

    await addHistory(req.tenantDb, cr.id, 'UNDER_REVIEW', req.user.id, req.user.role?.name, 'Review started');

    res.status(200).json({ status: 'success', data: cr });
  } catch (error) {
    logger.error({ err: error }, 'Failed to review request');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const approveRequest = async (req, res) => {
  try {
    const cr = await req.tenantDb.ChangeRequest.findByPk(req.params.id);
    if (!cr) return res.status(404).json({ status: 'error', message: 'Request not found' });
    
    const role = req.user.role?.name || 'Caseworker';

    // Risk-Level Validation
    if ((cr.risk_level === 'HIGH' || cr.risk_level === 'CRITICAL') && role !== 'Organisation Admin' && role !== 'Super Admin') {
      return res.status(403).json({ status: 'error', message: `Risk level ${cr.risk_level} requires Admin approval.` });
    }

    cr.status = 'APPROVED';
    cr.reviewed_by = req.user.id;
    cr.review_notes = req.validated.body.notes || 'Approved automatically by workflow';
    await cr.save();

    await addHistory(req.tenantDb, cr.id, 'APPROVED', req.user.id, role, cr.review_notes);

    // Update actual record (this triggers Phase 2 hooks for AuditLog and Field-Level Timeline)
    const Model = resolveEntityModel(req.tenantDb, cr.entity_type);
    if (Model) {
      const record = await Model.findByPk(cr.entity_id);
      if (record) {
        await record.update({ [cr.field_name]: cr.requested_value }, { performedBy: req.user.id, role, ipAddress: req.ip });
      }
    }

    // High Level CR Timeline Entry
    const readableField = cr.field_name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    if (cr.case_id) {
      await recordTimelineEntry({
        tenantDb: req.tenantDb,
        caseId: cr.case_id,
        actionType: 'status_changed',
        description: `${readableField} change approved by ${role}`,
        performedBy: req.user.id,
        visibility: 'public'
      });
    }

    // Notifications (Notify Requestor & Admin/Caseworker)
    const notifyTargets = [cr.submitted_by];
    if (role === 'Organisation Admin' && cr.case_id) {
        const caseRecord = await req.tenantDb.Case.findByPk(cr.case_id);
        if (caseRecord && caseRecord.assignedCaseworkerId) {
            const cwIds = Array.isArray(caseRecord.assignedCaseworkerId) ? caseRecord.assignedCaseworkerId : [caseRecord.assignedCaseworkerId];
            notifyTargets.push(...cwIds);
        }
    } else if (cr.organisation_id) {
        const admins = await req.tenantDb.User.findAll({ where: { role_id: 2, organisation_id: cr.organisation_id } });
        notifyTargets.push(...admins.map(a => a.id));
    }

    const uniqueTargets = [...new Set(notifyTargets)].filter(id => String(id) !== String(req.user.id));
    
    for (const targetId of uniqueTargets) {
      await notifyUser(req.tenantDb, targetId, {
        type: NotificationTypes.SUCCESS,
        priority: NotificationPriority.HIGH,
        title: `Change Request Approved`,
        message: `Your request to change ${readableField} has been approved.`,
        actionType: 'change_request_approved',
        entityId: cr.id,
        entityType: 'change_request'
      });
    }

    // Mark as COMPLETED immediately for standard workflows
    cr.status = 'COMPLETED';
    await cr.save();
    await addHistory(req.tenantDb, cr.id, 'COMPLETED', req.user.id, role, 'Workflow finished');

    res.status(200).json({ status: 'success', data: cr });
  } catch (error) {
    logger.error({ err: error }, 'Failed to approve request');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    const cr = await req.tenantDb.ChangeRequest.findByPk(req.params.id);
    if (!cr) return res.status(404).json({ status: 'error', message: 'Request not found' });
    
    const role = req.user.role?.name || 'Caseworker';

    cr.status = 'REJECTED';
    cr.reviewed_by = req.user.id;
    cr.review_notes = req.validated.body.notes || 'No reason provided';
    await cr.save();

    await addHistory(req.tenantDb, cr.id, 'REJECTED', req.user.id, role, cr.review_notes);

    const readableField = cr.field_name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

    if (cr.case_id) {
      await recordTimelineEntry({
        tenantDb: req.tenantDb,
        caseId: cr.case_id,
        actionType: 'status_changed',
        description: `${readableField} change rejected by ${role}`,
        performedBy: req.user.id,
        visibility: 'public'
      });
    }

    if (String(cr.submitted_by) !== String(req.user.id)) {
      await notifyUser(req.tenantDb, cr.submitted_by, {
        type: NotificationTypes.WARNING,
        priority: NotificationPriority.HIGH,
        title: `Change Request Rejected`,
        message: `Your request to change ${readableField} was rejected. Reason: ${cr.review_notes}`,
        actionType: 'change_request_rejected',
        entityId: cr.id,
        entityType: 'change_request'
      });
    }

    res.status(200).json({ status: 'success', data: cr });
  } catch (error) {
    logger.error({ err: error }, 'Failed to reject request');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const escalateRequest = async (req, res) => {
  try {
    const cr = await req.tenantDb.ChangeRequest.findByPk(req.params.id);
    if (!cr) return res.status(404).json({ status: 'error', message: 'Request not found' });
    
    const role = req.user.role?.name || 'Caseworker';

    cr.status = 'ESCALATED';
    cr.reviewed_by = req.user.id;
    cr.review_notes = req.validated.body.notes || 'Escalated for higher review';
    await cr.save();

    await addHistory(req.tenantDb, cr.id, 'ESCALATED', req.user.id, role, cr.review_notes);

    res.status(200).json({ status: 'success', data: cr });
  } catch (error) {
    logger.error({ err: error }, 'Failed to escalate request');
    res.status(500).json({ status: 'error', message: error.message });
  }
};
