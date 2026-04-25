import db from '../models/index.js';

const CaseTimeline = db.CaseTimeline;

/**
 * Add an entry to a case's timeline
 * @param {Object} data - Timeline entry data
 * @param {number} data.caseId - Case ID
 * @param {string} data.actionType - Type of action
 * @param {string} data.description - Description of the action
 * @param {number} data.performedBy - User ID who performed the action
 * @param {string} data.visibility - Visibility level ('public', 'internal', 'admin_only')
 * @param {Object} data.metadata - Additional metadata
 * @param {string} data.previousValue - Value before change
 * @param {string} data.newValue - Value after change
 * @param {boolean} data.isSystemAction - Whether it's a system action
 * @returns {Promise<Object>} Created timeline entry
 */
export const addTimelineEntry = async (data) => {
  try {
    const {
      caseId,
      actionType,
      description,
      performedBy,
      visibility = 'public',
      metadata = {},
      previousValue,
      newValue,
      isSystemAction = false
    } = data;

    if (!caseId || !actionType || !description) {
      throw new Error('caseId, actionType, and description are required for timeline entry');
    }

    const timelineEntry = await CaseTimeline.create({
      caseId,
      actionType,
      description,
      performedBy,
      visibility,
      metadata,
      previousValue,
      newValue,
      isSystemAction,
      actionDate: new Date()
    });

    return timelineEntry;
  } catch (error) {
    console.error('Error adding timeline entry:', error);
    // Don't throw error here to prevent blocking the main operation
    return null;
  }
};
