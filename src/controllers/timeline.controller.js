import db from '../models/index.js';

const CaseTimeline = db.CaseTimeline;
const Case = db.Case;
const User = db.User;

/**
 * Get timeline entries for a specific case
 */
export const getCaseTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    // Support both numeric PK (id) and human-readable case reference (caseId)
    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };
    const caseData = await Case.findOne({ where: whereClause });
    
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const timeline = await CaseTimeline.findAll({
      where: { caseId: caseData.id },
      include: [
        {
          model: User,
          as: 'performer',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ],
      order: [['actionDate', 'DESC']]
    });

    res.status(200).json({
      status: "success",
      message: "Timeline retrieved successfully",
      data: timeline
    });
  } catch (error) {
    console.error("Get Timeline Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Create a new timeline entry
 */
export const createTimelineEntry = async (req, res) => {
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
    } = req.body;

    if (!caseId || !actionType || !description) {
      return res.status(400).json({
        status: "error",
        message: "caseId, actionType, and description are required",
        data: null,
      });
    }

    // Verify case exists
    const caseData = await Case.findOne({ 
      where: isNaN(caseId) ? { caseId: caseId } : { id: parseInt(caseId) }
    });
    
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const timelineEntry = await CaseTimeline.create({
      caseId: caseData.id,
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

    // Fetch the created entry with performer details
    const createdEntry = await CaseTimeline.findByPk(timelineEntry.id, {
      include: [
        {
          model: User,
          as: 'performer',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ]
    });

    res.status(201).json({
      status: "success",
      message: "Timeline entry created successfully",
      data: createdEntry
    });
  } catch (error) {
    console.error("Create Timeline Entry Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Update a timeline entry
 */
export const updateTimelineEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { actionType, description, visibility, metadata } = req.body;

    const timelineEntry = await CaseTimeline.findByPk(id);
    
    if (!timelineEntry) {
      return res.status(404).json({
        status: "error",
        message: "Timeline entry not found",
        data: null,
      });
    }

    // Only allow updating manual entries (not system actions)
    if (timelineEntry.isSystemAction) {
      return res.status(403).json({
        status: "error",
        message: "Cannot update system-generated timeline entries",
        data: null,
      });
    }

    const updateData = {};
    if (actionType !== undefined) updateData.actionType = actionType;
    if (description !== undefined) updateData.description = description;
    if (visibility !== undefined) updateData.visibility = visibility;
    if (metadata !== undefined) updateData.metadata = metadata;

    await timelineEntry.update(updateData);

    // Fetch updated entry with performer details
    const updatedEntry = await CaseTimeline.findByPk(id, {
      include: [
        {
          model: User,
          as: 'performer',
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Timeline entry updated successfully",
      data: updatedEntry
    });
  } catch (error) {
    console.error("Update Timeline Entry Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Delete a timeline entry
 */
export const deleteTimelineEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const timelineEntry = await CaseTimeline.findByPk(id);
    
    if (!timelineEntry) {
      return res.status(404).json({
        status: "error",
        message: "Timeline entry not found",
        data: null,
      });
    }

    // Only allow deleting manual entries (not system actions)
    if (timelineEntry.isSystemAction) {
      return res.status(403).json({
        status: "error",
        message: "Cannot delete system-generated timeline entries",
        data: null,
      });
    }

    await timelineEntry.destroy();

    res.status(200).json({
      status: "success",
      message: "Timeline entry deleted successfully",
      data: null
    });
  } catch (error) {
    console.error("Delete Timeline Entry Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
