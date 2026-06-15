import { Op } from 'sequelize';
import { notifyEscalationCreated, notifyEscalationResolved } from '../../../services/notification.service.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';
import { localDateStr } from '../../../utils/dateHelpers.js';
import logger from '../../../utils/logger.js';


/**
 * Coerce a form value into a nullable integer for INTEGER FK columns.
 * Empty strings, null, undefined, and non-numeric values all become null
 * (avoids Postgres 'invalid input syntax for type integer: ""').
 */
const toNullableInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
};

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

const getEscalationListIncludes = (req) => [
  {
    model: req.tenantDb.User,
    as: "assignedAdmin",
    attributes: ["id", "first_name", "last_name", "email"],
  },
  {
    model: req.tenantDb.Case,
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

    // assignedAdminId and relatedCaseId are nullable INTEGER FKs. The form may send
    // "" (empty string) for an unset value, which Postgres rejects with
    // 'invalid input syntax for type integer: ""'. Coerce empty/blank to null.
    const adminFk = toNullableInt(assignedAdminId);
    const relatedCaseFk = toNullableInt(relatedCaseId);

    let assignedAdminName = null;
    if (adminFk) {
      const admin = await req.tenantDb.User.findByPk(adminFk);
      if (admin) {
        assignedAdminName = `${admin.first_name} ${admin.last_name}`;
      }
    }

    const escalation = await req.tenantDb.Escalation.create({
      caseId,
      candidate,
      severity,
      trigger,
      triggerType: triggerType || "Other",
      assignedAdminId: adminFk,
      assignedAdminName,
      daysOpen: 0,
      status: "Open",
      notes,
      relatedCaseId: relatedCaseFk,
    });

    // Send notification to assigned admin
    if (adminFk) {
      try {
        await notifyEscalationCreated(req.tenantDb, adminFk, {
          id: escalation.id,
          title: trigger,
          caseId: caseId,
          priority: severity,
        });
      } catch (notifError) {
        logger.error({ err: notifError }, 'Failed to send escalation notification');
      }
    }

    res.status(201).json({
      status: "success",
      message: "Escalation created successfully",
      data: escalation,
    });
  } catch (error) {
    logger.error({ err: error }, "Error creating escalation");
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
      req.tenantDb.Escalation.findAll({
        where: whereClause,
        order: [["created_at", "DESC"]],
        include: getEscalationListIncludes(req),
      }),
      req.tenantDb.Escalation.findAll({
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
    logger.error({ err: error }, "Error fetching escalations");
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

    const escalation = await req.tenantDb.Escalation.findByPk(id, {
      include: [
        {
          model: req.tenantDb.User,
          as: "assignedAdmin",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: req.tenantDb.Case,
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
    logger.error({ err: error }, "Error fetching escalation");
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
    const { severity, trigger, triggerType, assignedAdminId, relatedCaseId, status, notes } = req.body;

    const escalation = await req.tenantDb.Escalation.findByPk(id);

    if (!escalation) {
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    // Nullable INTEGER FKs — coerce "" / blanks to null (see createEscalation).
    const adminFk =
      assignedAdminId !== undefined ? toNullableInt(assignedAdminId) : escalation.assignedAdminId;

    let assignedAdminName = escalation.assignedAdminName;
    if (adminFk && adminFk !== escalation.assignedAdminId) {
      const admin = await req.tenantDb.User.findByPk(adminFk);
      if (admin) {
        assignedAdminName = `${admin.first_name} ${admin.last_name}`;
      }
    } else if (adminFk === null) {
      assignedAdminName = null;
    }

    const oldStatus = escalation.status;

    const updateData = {
      severity: severity || escalation.severity,
      trigger: trigger || escalation.trigger,
      triggerType: triggerType || escalation.triggerType,
      assignedAdminId: adminFk,
      assignedAdminName,
      relatedCaseId:
        relatedCaseId !== undefined ? toNullableInt(relatedCaseId) : escalation.relatedCaseId,
      status: status || escalation.status,
      notes: notes !== undefined ? notes : escalation.notes,
    };

    if (status === "Resolved" || status === "Closed") {
      if (!escalation.resolvedAt) {
        updateData.resolvedAt = new Date();
        updateData.resolvedBy = req.user.userId;
      }
    }

    await req.tenantDb.Escalation.update(updateData, { where: { id } });

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
          await notifyEscalationResolved(req.tenantDb, userIdsToNotify, {
            id: escalation.id,
            title: escalation.trigger,
            caseId: escalation.caseId,
            resolution: notes || 'Escalation resolved',
          });
        } catch (notifError) {
          logger.error({ err: notifError }, 'Failed to send escalation resolved notification');
        }
      }
    }

    const updatedEscalation = await req.tenantDb.Escalation.findByPk(id, {
      include: [
        {
          model: req.tenantDb.User,
          as: "assignedAdmin",
          attributes: ["id", "first_name", "last_name", "email"],
        },
        {
          model: req.tenantDb.Case,
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
    logger.error({ err: error }, "Error updating escalation");
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

    const escalation = await req.tenantDb.Escalation.findByPk(id);

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
    logger.error({ err: error }, "Error deleting escalation");
    res.status(500).json({
      status: "error",
      message: "Failed to delete escalation",
      error: error.message,
    });
  }
};

export const getEscalationKPI = async (req, res) => {
  try {
    const escalations = await req.tenantDb.Escalation.findAll({
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
    const resolvedToday = await req.tenantDb.Escalation.findAll({
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
    logger.error({ err: error }, "Error fetching KPI");
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

    const escalations = await req.tenantDb.Escalation.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      include: getEscalationListIncludes(req),
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

      // Prefer the joined User row; fall back to the denormalized name stored on the escalation
      const adminName = (adm?.first_name != null)
        ? `${adm.first_name} ${adm.last_name ?? ""}`.trim()
        : (j.assignedAdminName ?? "");
      const adminEmail = adm?.email ?? "";

      const createdStr = j.created_at ? localDateStr(new Date(j.created_at)) : "";
      const resolvedStr = j.resolvedAt ? localDateStr(new Date(j.resolvedAt)) : "";

      return {
        id: j.id,
        caseId: j.caseId ?? "",
        candidate: j.candidate ?? "",
        severity: j.severity ?? "",
        triggerType: j.triggerType ?? "",
        trigger: j.trigger ?? "",
        status: j.status ?? "",
        assignedAdmin: adminName,
        assignedAdminEmail: adminEmail,
        daysOpen: calculateDaysOpen(j.created_at),
        relatedCaseRef: j.relatedCase?.caseId ?? "",
        createdAtStr: createdStr,
        resolvedAtStr: resolvedStr,
        notes: j.notes ?? "",
      };
    });

    const buffer = rowsToXlsxBuffer(rows, columns);
    const day = localDateStr();
    sendXlsxDownload(res, buffer, `escalations_${day}`);
  } catch (error) {
    logger.error({ err: error }, "Error exporting escalations");
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

    const escalation = await req.tenantDb.Escalation.findByPk(id);

    if (!escalation) {
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    const admin = await req.tenantDb.User.findByPk(assignedAdminId);

    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
      });
    }

    await req.tenantDb.Escalation.update(
      {
        assignedAdminId,
        assignedAdminName: `${admin.first_name} ${admin.last_name}`,
      },
      { where: { id } }
    );

    const updatedEscalation = await req.tenantDb.Escalation.findByPk(id, {
      include: [
        {
          model: req.tenantDb.User,
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
    logger.error({ err: error }, "Error assigning escalation");
    res.status(500).json({
      status: "error",
      message: "Failed to assign escalation",
      error: error.message,
    });
  }
};
