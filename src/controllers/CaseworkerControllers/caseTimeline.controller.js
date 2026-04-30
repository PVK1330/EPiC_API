import db from "../../models/index.js";
import { recordAuditLog } from "../../services/audit.service.js";

const { CaseTimeline, Case, User } = db;

/**
 * Get timeline entries for a specific case
 */
export const getCaseTimeline = async (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.user?.id;

    const timeline = await CaseTimeline.findAll({
      where: { caseId },
      include: [
        {
          model: User,
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
    console.error('Error fetching case timeline:', error);
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

    const timelineEntry = await CaseTimeline.create({
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
    console.error('Error adding timeline entry:', error);
    res.status(500).json({ success: false, message: 'Failed to add timeline entry' });
  }
};

/**
 * Get timeline statistics for a case
 */
export const getCaseTimelineStats = async (req, res) => {
  try {
    const { caseId } = req.params;

    const stats = await CaseTimeline.findAll({
      where: { caseId },
      attributes: [
        'actionType',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
      ],
      group: ['actionType'],
      raw: true,
    });

    const totalEntries = await CaseTimeline.count({ where: { caseId } });
    const firstEntry = await CaseTimeline.findOne({
      where: { caseId },
      order: [['actionDate', 'ASC']],
    });
    const lastEntry = await CaseTimeline.findOne({
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
    console.error('Error fetching timeline stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch timeline stats' });
  }
};
