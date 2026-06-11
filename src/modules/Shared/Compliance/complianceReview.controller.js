import logger from '../../../utils/logger.js';
import {
  applyComplianceStatusChange,
  notifySponsorOfReview,
  REVIEW_ACTIONS,
  REVIEW_ACTION_TARGET,
} from '../../../services/complianceDocument.service.js';

const reviewerInclude = (tenantDb) => [
  {
    model: tenantDb.User,
    as: 'sponsor',
    attributes: ['id', 'first_name', 'last_name', 'email'],
  },
  {
    model: tenantDb.User,
    as: 'reviewer',
    attributes: ['id', 'first_name', 'last_name', 'email'],
  },
];

/**
 * List compliance documents for the review queue. Optional filters:
 *   ?status=submitted|under_review|information_requested|approved|rejected
 *   ?sponsorId=<id>
 */
export const listComplianceDocumentsForReview = async (req, res) => {
  try {
    const { status, sponsorId } = req.query;

    const where = {};
    if (status && status !== 'All') {
      where.status = String(status).toLowerCase().replace(/\s+/g, '_');
    }
    if (sponsorId) {
      where.sponsorId = Number(sponsorId);
    }

    const documents = await req.tenantDb.ComplianceDocument.findAll({
      where,
      include: reviewerInclude(req.tenantDb),
      order: [['upload_date', 'DESC']],
    });

    return res.status(200).json({ status: 'success', data: documents });
  } catch (error) {
    logger.error({ err: error }, 'listComplianceDocumentsForReview error');
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

/** Single document with its full status-change audit trail. */
export const getComplianceDocumentForReview = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await req.tenantDb.ComplianceDocument.findByPk(id, {
      include: [
        ...reviewerInclude(req.tenantDb),
        {
          model: req.tenantDb.ComplianceDocumentAudit,
          as: 'auditTrail',
          separate: true,
          order: [['reviewed_at', 'DESC']],
          include: [
            {
              model: req.tenantDb.User,
              as: 'reviewer',
              attributes: ['id', 'first_name', 'last_name', 'email'],
            },
          ],
        },
      ],
    });

    if (!document) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    return res.status(200).json({ status: 'success', data: document });
  } catch (error) {
    logger.error({ err: error }, 'getComplianceDocumentForReview error');
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

/**
 * Shared handler factory for reviewer status actions.
 * @param {string} action one of REVIEW_ACTIONS
 * @param {boolean} isReviewAction whether reviewer decision fields are stamped
 */
const handleReviewAction = (action, isReviewAction) => async (req, res) => {
  try {
    const actorId = req.user.userId;
    const { id } = req.params;
    const notes = req.body?.notes ?? null;

    const document = await req.tenantDb.ComplianceDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    const newStatus = REVIEW_ACTION_TARGET[action];

    await applyComplianceStatusChange({
      tenantDb: req.tenantDb,
      document,
      newStatus,
      actorId,
      action,
      notes,
      isReviewAction,
      req,
    });

    await notifySponsorOfReview({
      tenantDb: req.tenantDb,
      document,
      action,
      newStatus,
      notes,
    });

    return res.status(200).json({
      status: 'success',
      message: `Document ${newStatus.replace(/_/g, ' ')} successfully`,
      data: document,
    });
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') {
      return res.status(409).json({ status: 'error', message: error.message });
    }
    logger.error({ err: error }, `compliance review action '${action}' error`);
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

// Reviewer marks a submitted document as actively under review (optional step).
export const startComplianceReview = handleReviewAction(REVIEW_ACTIONS.START_REVIEW, false);
export const approveComplianceDocument = handleReviewAction(REVIEW_ACTIONS.APPROVE, true);
export const rejectComplianceDocument = handleReviewAction(REVIEW_ACTIONS.REJECT, true);
export const requestComplianceInformation = handleReviewAction(REVIEW_ACTIONS.REQUEST_INFO, true);
