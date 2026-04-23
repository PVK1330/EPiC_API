import db from "../../models/index.js";
import { Op } from "sequelize";
import { notifyCaseAssigned, notifyCaseStatusChanged } from "../../services/notification.service.js";

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
  
  return `CAS-${String(nextId).padStart(6, "0")}`;
};

// Create Case
export const createCase = async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({
        status: "error",
        message: "Request body is required",
        data: null,
      });
    }

    const {
      candidateId,              // INTEGER - Foreign key to users table
      sponsorId,                // INTEGER - Foreign key to users table  
      visaTypeId,
      petitionTypeId,
      priority,
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      assignedcaseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
      nationality,
      jobTitle,
      department
    } = req.body;

    const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);

    // Field-wise validation
    const errors = [];
    
    if (candidateId === undefined || candidateId === null || candidateId === '') errors.push("candidateId is required");
    if (sponsorId === undefined || sponsorId === null || sponsorId === '') errors.push("sponsorId is required");
    if (visaTypeId === undefined || visaTypeId === null || visaTypeId === '') errors.push("visaTypeId is required");
    if (!cwIds.length) errors.push("assignedcaseworkerId is required");
    if (targetSubmissionDate === undefined || targetSubmissionDate === null || targetSubmissionDate === '') errors.push("targetSubmissionDate is required");
    if (totalAmount === undefined || totalAmount === null) errors.push("totalAmount is required");

    if (errors.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Validation failed",
        data: { errors },
      });
    }

    // Check if candidate exists
    const candidate = await db.User.findByPk(candidateId);
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null,
      });
    }

    // Check if sponsor exists
    const sponsor = await db.User.findByPk(sponsorId);
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null,
      });
    }

    const caseId = await generateCaseId();

    const newCase = await Case.create({
      caseId,
      candidateId,
      sponsorId,
      visaTypeId,
      petitionTypeId,
      priority: priority || "medium",
      status: "Pending",
      submitted: new Date(),
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      nationality,
      jobTitle,
      department,
      assignedcaseworkerId: cwIds,
      salaryOffered: salaryOffered || 0,
      totalAmount: totalAmount || 0,
      paidAmount: paidAmount || 0,
      notes,
    });

    // Send notifications to assigned caseworkers
    if (cwIds.length > 0) {
      // Fetch visa type name for notification
      const visaType = await db.VisaType.findByPk(visaTypeId);
      const visaTypeName = visaType ? visaType.name : 'Not specified';
      
      const caseData = {
        id: newCase.id,
        caseId: newCase.caseId,
        candidateName: `${candidate.first_name} ${candidate.last_name}`,
        visaType: visaTypeName,
      };
      for (const caseworkerId of cwIds) {
        try {
          await notifyCaseAssigned(caseworkerId, caseData);
        } catch (notifError) {
          console.error('Failed to send notification to caseworker:', caseworkerId, notifError);
        }
      }
    }

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

// Get Cases with Enhanced Filtering
export const getCasesWithFilters = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status, 
      priority, 
      visaTypeId,
      petitionTypeId,
      candidateId,
      sponsorId
    } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { '$candidate.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$candidate.last_name$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;
    if (visaTypeId) whereClause.visaTypeId = visaTypeId;
    if (petitionTypeId) whereClause.petitionTypeId = petitionTypeId;
    if (candidateId) whereClause.candidateId = candidateId;
    if (sponsorId) whereClause.sponsorId = sponsorId;

    const { count, rows: cases } = await Case.findAndCountAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.VisaType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
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
    console.error("Get Cases with Filters Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get All Cases with Statistics
export const getAllCases = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, priority, visaType } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
        { '$candidate.first_name$': { [Op.iLike]: `%${search}%` } },
        { '$candidate.last_name$': { [Op.iLike]: `%${search}%` } }
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
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    });

    // Get case statistics
    const totalCount = await Case.count();
    const pendingCount = await Case.count({ where: { status: 'Pending' } });
    const approvedCount = await Case.count({ where: { status: 'Completed' } });
    const rejectedCount = await Case.count({ where: { status: 'Cancelled' } });

    res.status(200).json({
      status: "success",
      message: "Cases retrieved successfully",
      data: {
        cases,
        statistics: {
          total: totalCount,
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
        },
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

    const caseData = await Case.findOne({ 
      where: { caseId: id },
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    }) || await Case.findByPk(id, {
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.User,
          as: 'sponsor', 
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ]
    });

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
    console.log("Update Case - Request received for ID:", id);
    
    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);
    console.log("Update Case - Found case:", caseData?.caseId);

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const {
      candidateId,
      sponsorId,
      visaTypeId,
      petitionTypeId,
      priority,
      status,
      targetSubmissionDate,
      lcaNumber,
      receiptNumber,
      assignedcaseworkerId,
      salaryOffered,
      totalAmount,
      paidAmount,
      notes,
      nationality,
      jobTitle,
      department,
    } = req.body;

    const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);

    const oldStatus = caseData.status;
    console.log("Update Case - Old status:", oldStatus, "New status:", status);

    const updateData = {
      candidateId: candidateId !== undefined ? candidateId : caseData.candidateId,
      sponsorId: sponsorId !== undefined ? sponsorId : caseData.sponsorId,
      visaTypeId: visaTypeId !== undefined ? visaTypeId : caseData.visaTypeId,
      petitionTypeId: petitionTypeId !== undefined ? petitionTypeId : caseData.petitionTypeId,
      priority: priority || caseData.priority,
      status: status || caseData.status,
      targetSubmissionDate: targetSubmissionDate || caseData.targetSubmissionDate,
      lcaNumber: lcaNumber !== undefined ? lcaNumber : caseData.lcaNumber,
      receiptNumber: receiptNumber !== undefined ? receiptNumber : caseData.receiptNumber,
      nationality: nationality !== undefined ? nationality : caseData.nationality,
      jobTitle: jobTitle !== undefined ? jobTitle : caseData.jobTitle,
      department: department !== undefined ? department : caseData.department,
      assignedcaseworkerId: cwIds.length > 0 ? cwIds : caseData.assignedcaseworkerId,
      salaryOffered: salaryOffered !== undefined ? salaryOffered : caseData.salaryOffered,
      totalAmount: totalAmount !== undefined ? totalAmount : caseData.totalAmount,
      paidAmount: paidAmount !== undefined ? paidAmount : caseData.paidAmount,
      notes: notes !== undefined ? notes : caseData.notes,
    };
    console.log("Update Case - Update data:", updateData);

    await caseData.update(updateData);
    console.log("Update Case - Update successful");

    // Send status change notification if status changed
    if (status && status !== oldStatus) {
      try {
        const candidate = await db.User.findByPk(caseData.candidateId);
        const sponsor = await db.User.findByPk(caseData.sponsorId);
        const userIdsToNotify = [];
        
        // Notify candidate
        if (candidate) userIdsToNotify.push(candidate.id);
        // Notify sponsor
        if (sponsor) userIdsToNotify.push(sponsor.id);
        // Notify assigned caseworkers
        if (caseData.assignedcaseworkerId) {
          userIdsToNotify.push(...caseData.assignedcaseworkerId);
        }

        if (userIdsToNotify.length > 0) {
          try {
            await notifyCaseStatusChanged(userIdsToNotify, {
              id: caseData.id,
              caseId: caseData.caseId,
              candidateName: candidate ? `${candidate.first_name} ${candidate.last_name}` : 'Unknown',
            }, oldStatus, status);
          } catch (notifError) {
            console.error('Failed to send status change notification:', notifError);
          }
        }
      } catch (error) {
        console.error('Error in notification process:', error);
      }
    }

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
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: db.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ],
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

    console.log(`Update Pipeline Stage - Case ID: ${id}, New Status: ${status}`);

    const caseData = await Case.findOne({ where: { caseId: id } }) || await Case.findByPk(id);

    if (!caseData) {
      console.log(`Case not found with ID: ${id}`);
      return res.status(404).json({ status: "error", message: "Case not found" });
    }

    console.log(`Found case, current status: ${caseData.status}`);
    await caseData.update({ status: status || caseData.status });
    console.log(`Updated case status to: ${caseData.status}`);

    res.status(200).json({
      status: "success",
      message: "Pipeline stage updated",
      data: { case: caseData }
    });
  } catch (error) {
    console.error("Update Pipeline Stage Error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
};

// Export Cases to CSV
export const exportCases = async (req, res) => {
  try {
    const { search, status, priority, visaType } = req.query;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { caseId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    if (priority) {
      whereClause.priority = priority;
    }

    if (visaType) {
      whereClause.visaTypeId = visaType;
    }

    const cases = await Case.findAll({
      where: whereClause,
      include: [
        {
          model: db.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name']
        }
      ],
      order: [["created_at", "DESC"]]
    });

    // Fetch caseworker names for all assigned caseworker IDs
    const allCaseworkerIds = new Set();
    cases.forEach(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? [c.assignedcaseworkerId] : []);
      cwIds.forEach(id => {
        // Convert to integer if it's a numeric string, otherwise skip
        const numId = parseInt(id);
        if (!isNaN(numId)) {
          allCaseworkerIds.add(numId);
        }
      });
    });

    const caseworkers = await db.User.findAll({
      where: { id: Array.from(allCaseworkerIds) },
      attributes: ['id', 'first_name', 'last_name']
    });

    const caseworkerMap = {};
    caseworkers.forEach(cw => {
      caseworkerMap[cw.id] = `${cw.first_name} ${cw.last_name}`;
    });

    // Generate CSV
    const csvHeader = ['Case ID', 'Candidate', 'Candidate Email', 'Sponsor', 'Sponsor Email', 'Visa Type', 'Petition Type', 'Priority', 'Status', 'Assigned Caseworkers', 'Submission Date', 'Target Date', 'LCA Number', 'Receipt Number', 'Salary Offered', 'Total Amount', 'Paid Amount', 'Created At'];
    const csvRows = cases.map(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? [c.assignedcaseworkerId] : []);
      const cwNames = cwIds.map(id => caseworkerMap[id] || `ID:${id}`).join(', ');
      
      return [
        c.caseId || 'N/A',
        c.candidate ? `${c.candidate.first_name} ${c.candidate.last_name}` : 'N/A',
        c.candidate?.email || 'N/A',
        c.sponsor ? `${c.sponsor.first_name} ${c.sponsor.last_name}` : 'N/A',
        c.sponsor?.email || 'N/A',
        c.visaType?.name || 'N/A',
        c.petitionType?.name || 'N/A',
        c.priority,
        c.status,
        cwNames || 'N/A',
        c.submissionDate || 'N/A',
        c.targetSubmissionDate || 'N/A',
        c.lcaNumber || 'N/A',
        c.receiptNumber || 'N/A',
        c.salaryOffered || 0,
        c.totalAmount || 0,
        c.paidAmount || 0,
        c.created_at || 'N/A'
      ];
    });

    const csvContent = [
      csvHeader.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cases_export.csv"');
    res.send(csvContent);

  } catch (error) {
    console.error("Export Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};
export const getTeamCapacity = async (req, res) => {
  try {
    const cases = await Case.findAll({
      attributes: ['assignedcaseworkerId'],
      where: {
        status: {
          [Op.notIn]: ['Approved', 'Rejected'] // Only active Cases
        }
      }
    });

    const userIds = new Set();
    cases.forEach(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : [];
      cwIds.forEach(id => userIds.add(id));
    });

    const users = await db.User.findAll({
      where: { id: Array.from(userIds) },
      attributes: ['id', 'first_name', 'last_name']
    });

    const userMap = {};
    users.forEach(u => {
      userMap[u.id] = `${u.first_name} ${u.last_name}`;
    });

    const capacityMap = {};
    cases.forEach(c => {
      const cwIds = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : [];
      if (cwIds.length === 0) {
        const cw = 'Unassigned';
        if (!capacityMap[cw]) capacityMap[cw] = 0;
        capacityMap[cw] += 1;
      } else {
        cwIds.forEach(id => {
          const cw = userMap[id] || `Caseworker ${id}`;
          if (!capacityMap[cw]) capacityMap[cw] = 0;
          capacityMap[cw] += 1;
        });
      }
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

    const cwIds = Array.isArray(assignTo) ? assignTo : (assignTo ? [assignTo] : caseData.assignedcaseworkerId);

    await caseData.update({
      assignedcaseworkerId: cwIds,
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
