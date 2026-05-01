import db from "../../models/index.js";
import { Op } from "sequelize";
import { notifyEscalationCreated, notifyEscalationResolved } from "../../services/notification.service.js";
import { rowsToXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";

const { Escalation, User, Case } = db;

/** Shared filters for listing and export (DRY). */
export const buildEscalationWhereClause = (query = {}) => {
  const { severity, status, triggerType, assignedAdminId, quickTypeFilter } =
    query;

  const and = [];

  if (severity && severity !== "All") {
    and.push({ severity });
  }
  if (status && status !== "All") {
    and.push({ status });
  }
  if (triggerType && triggerType !== "All") {
    and.push({ triggerType });
  }
  if (assignedAdminId) {
    and.push({ assignedAdminId });
  }

  /**
   * Same heuristics as AdminEscalations.jsx TYPE_FILTER (trigger substring checks).
   * Only applies when quickTypeFilter is set and not All.
   */
  if (quickTypeFilter && quickTypeFilter !== "All") {
    if (quickTypeFilter === "Deadline Breach") {
      and.push({ trigger: { [Op.iLike]: "%Deadline%" } });
    } else if (quickTypeFilter === "Missing Docs") {
      and.push({ trigger: { [Op.iLike]: "%BRP%" } });
    } else if (quickTypeFilter === "Stuck Case") {
      and.push({ trigger: { [Op.iLike]: "%stuck%" } });
    }
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0];
  return { [Op.and]: and };
};

const escalationListIncludes = [
  {
    model: User,
    as: "assignedAdmin",
    attributes: ["id", "first_name", "last_name", "email"],
  },
  {
    model: Case,
    as: "relatedCase",
    attributes: ["id", "caseId", "status"],
  },
];

const calculateDaysOpen = (createdAt) => {
  const created = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now - created);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/** KPI cards use full dataset so filters do not change headline numbers. */
const computeEscalationKpiFromRows = (rows) => {
  const list = rows.map((r) => (typeof r.toJSON === "function" ? r.toJSON() : r));
  return {
    critical: list.filter(
      (e) => e.severity === "Critical" && e.status !== "Resolved" && e.status !== "Closed",
    ).length,
    high: list.filter(
      (e) => e.severity === "High" && e.status !== "Resolved" && e.status !== "Closed",
    ).length,
    medium: list.filter(
      (e) => e.severity === "Medium" && e.status !== "Resolved" && e.status !== "Closed",
    ).length,
    resolvedToday: list.filter((e) => {
      if (e.resolvedAt) {
        const resolvedDate = new Date(e.resolvedAt).toDateString();
        const today = new Date().toDateString();
        return resolvedDate === today;
      }
      return false;
    }).length,
  };
};

export const createEscalation = async (req, res) => {
  try {
    const { caseId, candidate, severity, trigger, triggerType, assignedAdminId, relatedCaseId, notes } = req.body;

    if (!caseId || !candidate || !severity || !trigger) {
      return res.status(400).json({
        status: "error",
        message: "caseId, candidate, severity, and trigger are required",
      });
    }

    let assignedAdminName = null;
    if (assignedAdminId) {
      const admin = await User.findByPk(assignedAdminId);
      if (admin) {
        assignedAdminName = `${admin.first_name} ${admin.last_name}`;
      }
    }

    const escalation = await Escalation.create({
      caseId,
      candidate,
      severity,
      trigger,
      triggerType: triggerType || "Other",
      assignedAdminId,
      assignedAdminName,
      daysOpen: 0,
      status: "Open",
      notes,
      relatedCaseId,
    });

    // Send notification to assigned admin
    if (assignedAdminId) {
      try {
        await notifyEscalationCreated(assignedAdminId, {
          id: escalation.id,
          title: trigger,
          caseId: caseId,
          priority: severity,
        });
      } catch (notifError) {
        console.error('Failed to send escalation notification:', notifError);
      }
    }

    res.status(201).json({
      status: "success",
      message: "Escalation created successfully",
      data: escalation,
    });
  } catch (error) {
    console.error("Error creating escalation:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to create escalation",
      error: error.message,
    });
  }
};

export const getAllEscalations = async (req, res) => {
  try {
    const whereClause = buildEscalationWhereClause(req.query);

    const [escalations, kpiSourceRows] = await Promise.all([
      Escalation.findAll({
        where: whereClause,
        order: [["created_at", "DESC"]],
        include: escalationListIncludes,
      }),
      Escalation.findAll({
        attributes: ["severity", "status", "resolvedAt", "created_at"],
      }),
    ]);

    const escalationsWithDaysOpen = escalations.map((esc) => {
      const escalationData = esc.toJSON();
      escalationData.daysOpen = calculateDaysOpen(escalationData.created_at);
      return escalationData;
    });

    const kpi = computeEscalationKpiFromRows(kpiSourceRows);

    res.status(200).json({
      status: "success",
      message: "Escalations retrieved successfully",
      data: {
        escalations: escalationsWithDaysOpen,
        kpi,
      },
    });
  } catch (error) {
    console.error("Error fetching escalations:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch escalations",
      error: error.message,
    });
  }
};

export const getEscalationById = async (req, res) => {
  try {
    const { id } = req.params;

    const escalation = await Escalation.findByPk(id, {
      include: [
        {
          model: User,
          as: "assignedAdmin",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: Case,
          as: "relatedCase",
          attributes: ["id", "caseId", "status"],
        },
      ],
    });

    if (!escalation) {
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    const escalationData = escalation.toJSON();
    escalationData.daysOpen = calculateDaysOpen(escalationData.created_at);

    res.status(200).json({
      status: "success",
      message: "Escalation retrieved successfully",
      data: escalationData,
    });
  } catch (error) {
    console.error("Error fetching escalation:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch escalation",
      error: error.message,
    });
  }
};

export const updateEscalation = async (req, res) => {
  try {
    const { id } = req.params;
    const { severity, trigger, triggerType, assignedAdminId, status, notes } = req.body;

    const escalation = await Escalation.findByPk(id);

    if (!escalation) {
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    let assignedAdminName = escalation.assignedAdminName;
    if (assignedAdminId && assignedAdminId !== escalation.assignedAdminId) {
      const admin = await User.findByPk(assignedAdminId);
      if (admin) {
        assignedAdminName = `${admin.first_name} ${admin.last_name}`;
      }
    }

    const oldStatus = escalation.status;

    const updateData = {
      severity: severity || escalation.severity,
      trigger: trigger || escalation.trigger,
      triggerType: triggerType || escalation.triggerType,
      assignedAdminId: assignedAdminId !== undefined ? assignedAdminId : escalation.assignedAdminId,
      assignedAdminName,
      status: status || escalation.status,
      notes: notes !== undefined ? notes : escalation.notes,
    };

    if (status === "Resolved" || status === "Closed") {
      if (!escalation.resolvedAt) {
        updateData.resolvedAt = new Date();
        updateData.resolvedBy = req.user.userId;
      }
    }

    await escalation.update(updateData);

    // Send notification when escalation is resolved
    if (status && (status === "Resolved" || status === "Closed") && oldStatus !== status) {
      const userIdsToNotify = [];
      if (escalation.assignedAdminId) userIdsToNotify.push(escalation.assignedAdminId);
      // Also notify the admin who resolved it
      if (req.user.userId && !userIdsToNotify.includes(req.user.userId)) {
        userIdsToNotify.push(req.user.userId);
      }
      
      if (userIdsToNotify.length > 0) {
        try {
          await notifyEscalationResolved(userIdsToNotify, {
            id: escalation.id,
            title: escalation.trigger,
            caseId: escalation.caseId,
            resolution: notes || 'Escalation resolved',
          });
        } catch (notifError) {
          console.error('Failed to send escalation resolved notification:', notifError);
        }
      }
    }

    const updatedEscalation = await Escalation.findByPk(id, {
      include: [
        {
          model: User,
          as: "assignedAdmin",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: Case,
          as: "relatedCase",
          attributes: ["id", "caseId", "status"],
        },
      ],
    });

    const escalationData = updatedEscalation.toJSON();
    escalationData.daysOpen = calculateDaysOpen(escalationData.created_at);

    res.status(200).json({
      status: "success",
      message: "Escalation updated successfully",
      data: escalationData,
    });
  } catch (error) {
    console.error("Error updating escalation:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to update escalation",
      error: error.message,
    });
  }
};

export const deleteEscalation = async (req, res) => {
  try {
    const { id } = req.params;

    const escalation = await Escalation.findByPk(id);

    if (!escalation) {
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    await escalation.destroy();

    res.status(200).json({
      status: "success",
      message: "Escalation deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting escalation:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to delete escalation",
      error: error.message,
    });
  }
};

export const getEscalationKPI = async (req, res) => {
  try {
    const escalations = await Escalation.findAll({
      where: {
        status: { [Op.notIn]: ["Resolved", "Closed"] },
      },
    });

    const kpi = {
      critical: escalations.filter((e) => e.severity === "Critical").length,
      high: escalations.filter((e) => e.severity === "High").length,
      medium: escalations.filter((e) => e.severity === "Medium").length,
      low: escalations.filter((e) => e.severity === "Low").length,
      total: escalations.length,
    };

    const today = new Date().toDateString();
    const resolvedToday = await Escalation.findAll({
      where: {
        status: "Resolved",
        resolvedAt: {
          [Op.gte]: new Date(today),
        },
      },
    });

    kpi.resolvedToday = resolvedToday.length;

    res.status(200).json({
      status: "success",
      message: "KPI retrieved successfully",
      data: kpi,
    });
  } catch (error) {
    console.error("Error fetching KPI:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch KPI",
      error: error.message,
    });
  }
};

/** XLSX download; uses shared filters with GET / api/escalations (see buildEscalationWhereClause). */
export const exportEscalationsExcel = async (req, res) => {
  try {
    const whereClause = buildEscalationWhereClause(req.query);

    const escalations = await Escalation.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      include: escalationListIncludes,
    });

    const columns = [
      { key: "id", header: "ID" },
      { key: "caseId", header: "Case ID" },
      { key: "candidate", header: "Candidate" },
      { key: "severity", header: "Severity" },
      { key: "triggerType", header: "Trigger Type" },
      { key: "trigger", header: "Trigger Reason" },
      { key: "status", header: "Status" },
      { key: "assignedAdmin", header: "Assigned Admin" },
      { key: "assignedAdminEmail", header: "Admin Email" },
      { key: "daysOpen", header: "Days Open" },
      { key: "relatedCaseRef", header: "Related Case" },
      { key: "createdAtStr", header: "Created At" },
      { key: "resolvedAtStr", header: "Resolved At" },
      { key: "notes", header: "Notes" },
    ];

    const rows = escalations.map((esc) => {
      const j = esc.toJSON();
      const adm = j.assignedAdmin;
      const createdIso = j.created_at ? new Date(j.created_at).toISOString() : "";
      const resolvedIso = j.resolvedAt ? new Date(j.resolvedAt).toISOString() : "";
      return {
        id: j.id,
        caseId: j.caseId ?? "",
        candidate: j.candidate ?? "",
        severity: j.severity ?? "",
        triggerType: j.triggerType ?? "",
        trigger: j.trigger ?? "",
        status: j.status ?? "",
        assignedAdmin:
          adm && adm.first_name != null ? `${adm.first_name} ${adm.last_name ?? ""}` : "",
        assignedAdminEmail: adm?.email ?? "",
        daysOpen: calculateDaysOpen(j.created_at),
        relatedCaseRef: j.relatedCase?.caseId ?? "",
        createdAtStr: createdIso,
        resolvedAtStr: resolvedIso,
        notes: j.notes ?? "",
      };
    });

    const buffer = rowsToXlsxBuffer(rows, columns);
    const day = new Date().toISOString().split("T")[0];
    sendXlsxDownload(res, buffer, `escalations_${day}`);
  } catch (error) {
    console.error("Error exporting escalations:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to export escalations",
      error: error.message,
    });
  }
};

export const assignEscalation = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedAdminId } = req.body;

    if (!assignedAdminId) {
      return res.status(400).json({
        status: "error",
        message: "assignedAdminId is required",
      });
    }

    const escalation = await Escalation.findByPk(id);

    if (!escalation) {
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    const admin = await User.findByPk(assignedAdminId);

    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
      });
    }

    await escalation.update({
      assignedAdminId,
      assignedAdminName: `${admin.first_name} ${admin.last_name}`,
    });

    const updatedEscalation = await Escalation.findByPk(id, {
      include: [
        {
          model: User,
          as: "assignedAdmin",
          attributes: ["id", "first_name", "last_name", "email"],
        },
      ],
    });

    const escalationData = updatedEscalation.toJSON();
    escalationData.daysOpen = calculateDaysOpen(escalationData.created_at);

    res.status(200).json({
      status: "success",
      message: "Escalation assigned successfully",
      data: escalationData,
    });
  } catch (error) {
    console.error("Error assigning escalation:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to assign escalation",
      error: error.message,
    });
  }
};
