import db from "../../models/index.js";
import { Op } from "sequelize";

const Case = db.Case;

// Helper function to generate next case ID like #CAS-001 securely
const generateCaseId = async () => {
  const lastCase = await Case.findOne({
    order: [["created_at", "DESC"]],
  });

  let nextId = 1;
  if (lastCase && lastCase.caseId) {
    const parts = lastCase.caseId.split("-");
    if (parts.length === 2 && !isNaN(parseInt(parts[1], 10))) {
      nextId = parseInt(parts[1], 10) + 1;
    } else {
      const count = await Case.count();
      nextId = count + 1;
    }
  }
  
  return `#CAS-${String(nextId).padStart(3, "0")}`;
};

// Create Case
export const createCase = async (req, res) => {
  try {
    const {
      candidateName, candidate,
      candidateId,
      businessName, business,
      businessId,
      visaType,
      petitionType,
      priority,
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      assignedCaseworkerName, caseworker,
      caseworkerId, assignedCaseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
      nationality,
      jobTitle,
      department
    } = req.body;

    const candName = candidateName || candidate;
    const busName = businessName || business;
    const cwName = assignedCaseworkerName || caseworker;
    const cwId = assignedCaseworkerId || caseworkerId;

    // Basic validation
    if (!candName || !busName || !visaType || !cwName || !targetSubmissionDate || totalAmount === undefined) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields",
        data: null,
      });
    }

    const caseId = await generateCaseId();

    const newCase = await Case.create({
      caseId,
      candidate: candName,
      candidateId,
      business: busName,
      businessId,
      visaType,
      petitionType,
      priority: priority || "medium",
      status: "Pending",
      submitted: new Date(),
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      nationality,
      jobTitle,
      department,
      caseworker: cwName,
      caseworkerId: cwId,
      salaryOffered: salaryOffered || 0,
      totalAmount: totalAmount || 0,
      paidAmount: paidAmount || 0,
      notes,
    });

    res.status(201).json({
      status: "success",
      message: "Case created successfully",
      data: { case: newCase },
    });
  } catch (error) {
    console.error("Create Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get All Cases
export const getAllCases = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, priority, visaType } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { candidate: { [Op.iLike]: `%${search}%` } },
        { business: { [Op.iLike]: `%${search}%` } },
        { caseworker: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;
    if (visaType) whereClause.visaType = visaType;

    const { count, rows: cases } = await Case.findAndCountAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.status(200).json({
      status: "success",
      message: "Cases retrieved successfully",
      data: {
        cases,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get All Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get Case By ID
export const getCaseById = async (req, res) => {
  try {
    const { id } = req.params;

    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Case retrieved successfully",
      data: { case: caseData },
    });
  } catch (error) {
    console.error("Get Case by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update Case
export const updateCase = async (req, res) => {
  try {
    const { id } = req.params;
    
    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const {
      candidateName, candidate,
      candidateId,
      businessName, business,
      businessId,
      visaType,
      petitionType,
      priority,
      status,
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      assignedCaseworkerName, caseworker,
      assignedCaseworkerId, caseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
      nationality,
      jobTitle,
      department
    } = req.body;

    const candName = candidateName || candidate;
    const busName = businessName || business;
    const cwName = assignedCaseworkerName || caseworker;
    const cwId = assignedCaseworkerId || caseworkerId;

    await caseData.update({
      candidate: candName || caseData.candidate,
      candidateId: candidateId !== undefined ? candidateId : caseData.candidateId,
      business: busName || caseData.business,
      businessId: businessId !== undefined ? businessId : caseData.businessId,
      visaType: visaType || caseData.visaType,
      petitionType: petitionType !== undefined ? petitionType : caseData.petitionType,
      priority: priority || caseData.priority,
      status: status || caseData.status,
      targetSubmissionDate: targetSubmissionDate || caseData.targetSubmissionDate,
      lcaNumber: lcaNumber !== undefined ? lcaNumber : caseData.lcaNumber,
      receiptNumber: receiptNumber !== undefined ? receiptNumber : caseData.receiptNumber,
      nationality: nationality !== undefined ? nationality : caseData.nationality,
      jobTitle: jobTitle !== undefined ? jobTitle : caseData.jobTitle,
      department: department !== undefined ? department : caseData.department,
      caseworker: cwName || caseData.caseworker,
      caseworkerId: cwId !== undefined ? cwId : caseData.caseworkerId,
      salaryOffered: salaryOffered !== undefined ? salaryOffered : caseData.salaryOffered,
      totalAmount: totalAmount !== undefined ? totalAmount : caseData.totalAmount,
      paidAmount: paidAmount !== undefined ? paidAmount : caseData.paidAmount,
      notes: notes !== undefined ? notes : caseData.notes,
    });

    res.status(200).json({
      status: "success",
      message: "Case updated successfully",
      data: { case: caseData },
    });
  } catch (error) {
    console.error("Update Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Delete Case
export const deleteCase = async (req, res) => {
  try {
    const { id } = req.params;

    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    await caseData.destroy();

    res.status(200).json({
      status: "success",
      message: "Case deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get Pipeline Cases
export const getPipelineCases = async (req, res) => {
  try {
    const cases = await Case.findAll({
      order: [["created_at", "DESC"]],
    });

    const pipeline = {
      lead: [],
      docs: [],
      drafting: [],
      submitted: [],
      decision: [],
      closed: [],
    };

    cases.forEach(c => {
      const stat = (c.status || "Lead").toLowerCase();
      if (stat === "docs pending" || stat === "docs") pipeline.docs.push(c);
      else if (stat === "drafting") pipeline.drafting.push(c);
      else if (stat === "submitted") pipeline.submitted.push(c);
      else if (stat === "decision") pipeline.decision.push(c);
      else if (stat === "closed" || stat === "approved" || stat === "rejected") pipeline.closed.push(c);
      else pipeline.lead.push(c);
    });

    res.status(200).json({
      status: "success",
      message: "Pipeline cases retrieved successfully",
      data: pipeline
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Update Pipeline Stage (Drag and Drop)
export const updatePipelineStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; 

    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);

    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    await caseData.update({ status: status || caseData.status });

    res.status(200).json({
      status: "success",
      message: "Pipeline stage updated",
      data: { case: caseData }
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Get Team Capacity
export const getTeamCapacity = async (req, res) => {
  try {
    const cases = await Case.findAll({
      attributes: ['caseworker', 'caseworkerId'],
      where: {
        status: {
          [Op.notIn]: ['Approved', 'Rejected'] // Only active Cases
        }
      }
    });

    const capacityMap = {};
    cases.forEach(c => {
      const cw = c.caseworker || 'Unassigned';
      if (!capacityMap[cw]) capacityMap[cw] = 0;
      capacityMap[cw] += 1;
    });

    const capacityArray = Object.keys(capacityMap).map(name => ({
      name,
      val: capacityMap[name]
    }));

    res.status(200).json({
      status: "success",
      message: "Team capacity retrieved successfully",
      data: capacityArray
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Assign Case
export const assignCase = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignTo, assignToName, reason } = req.body;

    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);

    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    const updatedNotes = caseData.notes 
      ? `${caseData.notes}\n[System]: Reassigned to ${assignToName || assignTo}. Reason: ${reason}` 
      : `[System]: Reassigned to ${assignToName || assignTo}. Reason: ${reason}`;

    await caseData.update({
      caseworkerId: assignTo !== undefined ? assignTo : caseData.caseworkerId,
      caseworker: assignToName || caseData.caseworker,
      notes: updatedNotes
    });

    res.status(200).json({
      status: "success",
      message: "Case reassigned successfully",
      data: { case: caseData }
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};
