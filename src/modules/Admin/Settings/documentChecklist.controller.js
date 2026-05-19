import { Op } from "sequelize";
import {
  buildDocumentLookupMap,
  findDocumentForChecklistItem,
} from "../../../utils/documentMatch.utils.js";

/**
 * Get document checklist for a specific visa type
 */
export const getChecklistByVisaType = async (req, res) => {
  try {
    const { visaTypeId } = req.params;
    
    if (!visaTypeId) {
      return res.status(400).json({
        status: "error",
        message: "Visa type ID is required",
        data: null,
      });
    }

    const checklist = await req.tenantDb.DocumentChecklist.findAll({
      where: { visaTypeId },
      order: [['sortOrder', 'ASC'], ['category', 'ASC']]
    });

    // Group by category
    const grouped = checklist.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    }, {});

    res.status(200).json({
      status: "success",
      message: "Document checklist retrieved successfully",
      data: {
        checklist: grouped,
        total: checklist.length
      }
    });
  } catch (error) {
    console.error("Get Checklist Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Candidate: checklist for their own case (same payload as getCaseChecklist)
 */
export const getCandidateDocumentChecklist = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized",
        data: null,
      });
    }

    const caseRecord = await req.tenantDb.Case.findOne({
      where: { candidateId: userId },
      order: [["created_at", "DESC"]],
    });

    if (!caseRecord) {
      return res.status(200).json({
        status: "success",
        message: "No case linked yet",
        data: {
          checklist: {},
          completionPercentage: 0,
          total: 0,
          required: 0,
          completed: 0,
          caseId: null,
        },
      });
    }

    if (!caseRecord.visaTypeId) {
      return res.status(200).json({
        status: "success",
        message: "Visa type not assigned yet",
        data: {
          checklist: {},
          completionPercentage: 0,
          total: 0,
          required: 0,
          completed: 0,
          caseId: caseRecord.id,
        },
      });
    }

    req.params.caseId = String(caseRecord.id);
    return getCaseChecklist(req, res);
  } catch (error) {
    console.error("Get Candidate Document Checklist Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Get case document checklist with status
 */
export const getCaseChecklist = async (req, res) => {
  try {
    const { caseId } = req.params;

    if (!caseId) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    const Case = req.tenantDb.Case;

    // Handle both numeric id and string caseId
    let caseRecord;
    let numericCaseId;

    // If caseId is a number (or numeric string), try findByPk first
    if (!isNaN(parseInt(caseId))) {
      caseRecord = await req.tenantDb.Case.findByPk(parseInt(caseId));
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    // If not found by numeric id, try by string caseId
    if (!caseRecord) {
      caseRecord = await req.tenantDb.Case.findOne({ where: { caseId } });
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    if (!caseRecord) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Get case details to find visa type
    const caseData = await req.tenantDb.Case.findByPk(numericCaseId, {
      include: [{ model: req.tenantDb.VisaType, as: 'visaType' }]
    });

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    if (!caseData.visaTypeId) {
      return res.status(400).json({
        status: "error",
        message: "Case has no visa type assigned",
        data: null,
      });
    }

    // Get checklist for this visa type
    const checklist = await req.tenantDb.DocumentChecklist.findAll({
      where: { visaTypeId: caseData.visaTypeId },
      order: [['sortOrder', 'ASC'], ['category', 'ASC']]
    });

    const candidateId = caseData.candidateId;
    const docWhere = candidateId
      ? {
          [Op.or]: [
            { caseId: numericCaseId },
            { userId: candidateId, caseId: null },
          ],
        }
      : { caseId: numericCaseId };

    const existingDocuments = await req.tenantDb.Document.findAll({
      where: docWhere,
      order: [["uploadedAt", "DESC"]],
    });

    const docLookup = buildDocumentLookupMap(existingDocuments);

    const checklistWithStatus = checklist.map((item) => {
      const existingDoc = findDocumentForChecklistItem(item, docLookup);
      return {
        ...item.toJSON(),
        status: existingDoc ? existingDoc.status : "missing",
        documentId: existingDoc ? existingDoc.id : null,
        uploadedAt: existingDoc ? existingDoc.uploadedAt : null,
        expiryDate: existingDoc ? existingDoc.expiryDate : null,
      };
    });

    // Group by category
    const grouped = checklistWithStatus.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    }, {});

    // Calculate completion percentage
    const requiredCount = checklistWithStatus.filter(i => i.isRequired).length;
    const completedCount = checklistWithStatus.filter(
      (i) =>
        i.isRequired &&
        ["uploaded", "under_review", "approved"].includes(i.status),
    ).length;
    const completionPercentage = requiredCount > 0 
      ? Math.round((completedCount / requiredCount) * 100) 
      : 0;

    res.status(200).json({
      status: "success",
      message: "Case document checklist retrieved successfully",
      data: {
        caseId: numericCaseId,
        checklist: grouped,
        completionPercentage,
        total: checklistWithStatus.length,
        required: requiredCount,
        completed: completedCount
      }
    });
  } catch (error) {
    console.error("Get Case Checklist Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Create a new checklist item (Admin only)
 */
export const createChecklistItem = async (req, res) => {
  try {
    const {
      visaTypeId,
      documentType,
      documentName,
      description,
      isRequired,
      sortOrder,
      category
    } = req.body;

    if (!visaTypeId || !documentType || !documentName) {
      return res.status(400).json({
        status: "error",
        message: "visaTypeId, documentType, and documentName are required",
        data: null,
      });
    }

    const checklistItem = await req.tenantDb.DocumentChecklist.create({
      visaTypeId,
      documentType,
      documentName,
      description,
      isRequired: isRequired !== undefined ? isRequired : true,
      sortOrder: sortOrder !== undefined ? sortOrder : 0,
      category: category || 'other'
    });

    res.status(201).json({
      status: "success",
      message: "Checklist item created successfully",
      data: checklistItem
    });
  } catch (error) {
    console.error("Create Checklist Item Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Update a checklist item (Admin only)
 */
export const updateChecklistItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      documentType,
      documentName,
      description,
      isRequired,
      sortOrder,
      category
    } = req.body;

    const checklistItem = await req.tenantDb.DocumentChecklist.findByPk(id);
    
    if (!checklistItem) {
      return res.status(404).json({
        status: "error",
        message: "Checklist item not found",
        data: null,
      });
    }

    const updateData = {};
    if (documentType !== undefined) updateData.documentType = documentType;
    if (documentName !== undefined) updateData.documentName = documentName;
    if (description !== undefined) updateData.description = description;
    if (isRequired !== undefined) updateData.isRequired = isRequired;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (category !== undefined) updateData.category = category;

    await checklistItem.update(updateData);

    res.status(200).json({
      status: "success",
      message: "Checklist item updated successfully",
      data: checklistItem
    });
  } catch (error) {
    console.error("Update Checklist Item Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Delete a checklist item (Admin only)
 */
export const deleteChecklistItem = async (req, res) => {
  try {
    const { id } = req.params;

    const checklistItem = await req.tenantDb.DocumentChecklist.findByPk(id);
    
    if (!checklistItem) {
      return res.status(404).json({
        status: "error",
        message: "Checklist item not found",
        data: null,
      });
    }

    await checklistItem.destroy();

    res.status(200).json({
      status: "success",
      message: "Checklist item deleted successfully",
      data: null
    });
  } catch (error) {
    console.error("Delete Checklist Item Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

/**
 * Get all checklist items (Admin only)
 */
export const getAllChecklists = async (req, res) => {
  try {
    const { visaTypeId } = req.query;

    const whereClause = {};
    if (visaTypeId) {
      whereClause.visaTypeId = visaTypeId;
    }

    const checklists = await req.tenantDb.DocumentChecklist.findAll({
      where: whereClause,
      include: [{ model: req.tenantDb.VisaType, as: 'visaType', attributes: ['id', 'name'] }],
      order: [['visaTypeId', 'ASC'], ['sortOrder', 'ASC']]
    });

    res.status(200).json({
      status: "success",
      message: "Checklists retrieved successfully",
      data: checklists
    });
  } catch (error) {
    console.error("Get All Checklists Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
