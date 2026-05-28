import { recordAuditLog } from '../../../services/audit.service.js';
import logger from '../../../utils/logger.js';


/**
 * Get timeline entries for a specific case
 */
export const getCaseTimeline = async (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.user?.id;

    const timeline = await req.tenantDb.CaseTimeline.findAll({
      where: { caseId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'performer',
          attributes: ['id', 'first_name', 'last_name', 'email'],
        },
      ],
      order: [['actionDate', 'DESC']],
    });

    await recordAuditLog({
      userId,
      action: 'Timeline Viewed',
      resource: `Case #${caseId}`,
      status: 'Success',
      details: `Viewed timeline for case ${caseId}`,
      req,
    });

    res.json({ success: true, data: timeline });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching case timeline');
    res.status(500).json({ success: false, message: 'Failed to fetch timeline' });
  }
};

/**
 * Add a timeline entry for a case
 */
export const addTimelineEntry = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { actionType, description, previousValue, newValue, metadata, isSystemAction, visibility } = req.body;
    const userId = req.user?.id;

    const timelineEntry = await req.tenantDb.CaseTimeline.create({
      caseId,
      actionType,
      description,
      performedBy: userId,
      previousValue,
      newValue,
      metadata,
      isSystemAction: isSystemAction || false,
      visibility: visibility || 'public',
    });

    await recordAuditLog({
      userId,
      action: 'Timeline Entry Added',
      resource: `Case #${caseId}`,
      status: 'Success',
      details: `Added ${actionType} entry to case ${caseId}`,
      req,
    });

    res.status(201).json({ success: true, data: timelineEntry });
  } catch (error) {
    logger.error({ err: error }, 'Error adding timeline entry');
    res.status(500).json({ success: false, message: 'Failed to add timeline entry' });
  }
};

/**
 * Get timeline statistics for a case
 */
export const getCaseTimelineStats = async (req, res) => {
  try {
    const { caseId } = req.params;

    const stats = await req.tenantDb.CaseTimeline.findAll({
      where: { caseId },
      attributes: [
        'actionType',
        [req.tenantDb.sequelize.fn('COUNT', req.tenantDb.sequelize.col('id')), 'count'],
      ],
      group: ['actionType'],
      raw: true,
    });

    const totalEntries = await req.tenantDb.CaseTimeline.count({ where: { caseId } });
    const firstEntry = await req.tenantDb.CaseTimeline.findOne({
      where: { caseId },
      order: [['actionDate', 'ASC']],
    });
    const lastEntry = await req.tenantDb.CaseTimeline.findOne({
      where: { caseId },
      order: [['actionDate', 'DESC']],
    });

    res.json({
      success: true,
      data: {
        stats,
        totalEntries,
        firstActionDate: firstEntry?.actionDate,
        lastActionDate: lastEntry?.actionDate,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching timeline stats');
    res.status(500).json({ success: false, message: 'Failed to fetch timeline stats' });
  }
};
