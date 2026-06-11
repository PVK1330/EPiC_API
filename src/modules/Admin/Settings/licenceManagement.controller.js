import { Op } from "sequelize";
import { sendTransactionalEmail } from "../../../services/mail.service.js";
import { generateNotificationEmailTemplate } from "../../../utils/emailTemplates.js";
import logger from "../../../utils/logger.js";
import {
  activateSponsorLicence,
  isCosRequestApplication,
} from "../../../services/licenceActivation.service.js";
import {
  loadFullApplication as loadFullApplicationV2,
  serializeApplication as serializeApplicationV2,
} from "../../../services/licenceApplicationV2.service.js";
import {
  recordLicenceAudit,
  statusToAuditAction,
  extractCaseworkerIds,
  LICENCE_AUDIT_ACTIONS,
} from "../../../services/licenceAssignment.service.js";
import {
  listCosRequests,
  assignCosRequest,
  reviewCosRequest,
} from "../../../services/cosRequest.service.js";
import * as sponsorshipNotify from "../../../services/sponsorshipNotification.service.js";

export const getAllLicenceApplications = async (req, res) => {
  try {
    const { status, type } = req.query;
    const whereClause = {};
    // Unsubmitted V2 drafts are private to the sponsor — never surface them to reviewers.
    if (status) whereClause.status = status;
    else whereClause.status = { [Op.ne]: "Draft" };
    if (type) whereClause.type = type;

    const applications = await req.tenantDb.LicenceApplication.findAll({
      where: whereClause,
      include: [
        {
          model: req.tenantDb.User,
          as: "user",
          attributes: ["id", "first_name", "last_name", "email"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      status: "success",
      data: applications,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching all licence applications");
    res.status(500).json({
      status: "error",
      message: "Failed to fetch licence applications",
      error: error.message,
    });
  }
};

/** GET /api/admin/licence/v2/:id — full normalized V2 application (read-only reviewer view). */
export const getLicenceApplicationV2 = async (req, res) => {
  try {
    const app = await loadFullApplicationV2(req.tenantDb, req.params.id, {});
    if (!app) {
      return res.status(404).json({ status: "error", message: "Licence application not found" });
    }
    return res.status(200).json({ status: "success", data: serializeApplicationV2(app) });
  } catch (error) {
    logger.error({ err: error }, "getLicenceApplicationV2 (admin) failed");
    return res.status(500).json({ status: "error", message: "Failed to fetch application" });
  }
};

export const updateLicenceApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const application = await req.tenantDb.LicenceApplication.findByPk(id);

    if (!application) {
      return res.status(404).json({
        status: "error",
        message: "Licence application not found",
      });
    }

    const previousStatus = application.status;

    application.status = status;
    if (adminNotes) application.adminNotes = adminNotes;
    await application.save();

    // On approval, activate the sponsor licence (Phase 4 — Licence Activation:
    // status Active, licence number, issue/expiry dates, audit, notification).
    // CoS top-ups are owned by the dedicated CoS request workflow
    // (cosRequest.service); the isCosRequestApplication guard keeps any
    // pre-migration "CoS Request:" licence row from activating a licence.
    if (status === "Approved" && !isCosRequestApplication(application)) {
      try {
        await activateSponsorLicence({
          tenantDb: req.tenantDb,
          application,
          approvedByUserId: req.user?.userId ?? null,
          req,
        });
      } catch (err) {
        logger.error({ err }, "Failed to activate sponsor licence");
      }
    }

    // Events 4/6 — Information Requested / Licence Rejected / status change.
    // Approved is skipped here (handled by licence activation, event 5).
    try {
      await sponsorshipNotify.licenceStatusChanged({
        tenantDb: req.tenantDb,
        application,
        status,
        adminNotes,
        req,
      });
    } catch (notifyErr) {
      logger.error({ err: notifyErr }, "Failed to send status notification");
    }

    // Reviewer action audit (admin override path).
    await recordLicenceAudit({
      tenantDb: req.tenantDb,
      application,
      actorId: req.user?.userId ?? null,
      action: statusToAuditAction(status),
      previousStatus,
      newStatus: status,
      notes: adminNotes || null,
      req,
    });

    res.status(200).json({
      status: "success",
      message: `Licence application ${status.toLowerCase()} successfully`,
      data: application,
    });
  } catch (error) {
    logger.error({ err: error }, "Error updating licence application status");
    res.status(500).json({
      status: "error",
      message: "Failed to update licence application status",
      error: error.message,
    });
  }
};

export const getAdminLicenceApplicationDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const application = await req.tenantDb.LicenceApplication.findByPk(id, {
      include: [
        {
          model: req.tenantDb.User,
          as: "user",
          attributes: ["id", "first_name", "last_name", "email"],
        },
      ],
    });

    if (!application) {
      return res.status(404).json({
        status: "error",
        message: "Licence application not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: application,
    });
  } catch (error) {
    logger.error(
      { err: error },
      "Error fetching licence application details for admin",
      error,
    );
    res.status(500).json({
      status: "error",
      message: "Failed to fetch licence application details",
      error: error.message,
    });
  }
};

export const requestAdditionalInformation = async (req, res) => {
  try {
    const { id } = req.params;
    const { requestedDocuments, adminNotes } = req.body;

    const application = await req.tenantDb.LicenceApplication.findByPk(id);

    if (!application) {
      return res.status(404).json({
        status: "error",
        message: "Licence application not found",
      });
    }

    const previousStatus = application.status;

    application.status = "Information Requested";
    application.requestedDocuments = requestedDocuments; // Array of doc titles or instructions
    if (adminNotes) application.adminNotes = adminNotes;
    await application.save();

    // Event 4 — Information Requested (in-app + email).
    try {
      await sponsorshipNotify.informationRequested({
        tenantDb: req.tenantDb,
        application,
        adminNotes,
        req,
      });
    } catch (notifyErr) {
      logger.error({ err: notifyErr }, "Failed to send info request notification");
    }

    // Reviewer action audit (Request Information).
    await recordLicenceAudit({
      tenantDb: req.tenantDb,
      application,
      actorId: req.user?.userId ?? null,
      action: LICENCE_AUDIT_ACTIONS.REQUEST_INFO,
      previousStatus,
      newStatus: "Information Requested",
      notes: adminNotes || null,
      req,
    });

    res.status(200).json({
      status: "success",
      message: "Information request sent to business successfully",
      data: application,
    });
  } catch (error) {
    logger.error({ err: error }, "Error requesting additional information");
    res.status(500).json({
      status: "error",
      message: "Failed to request information",
      error: error.message,
    });
  }
};

export const assignCaseworker = async (req, res) => {
  try {
    const { id } = req.params;
    const { caseworkerIds } = req.body; // Array of IDs

    if (!Array.isArray(caseworkerIds) || caseworkerIds.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "caseworkerIds must be a non-empty array",
      });
    }

    const application = await req.tenantDb.LicenceApplication.findByPk(id);

    if (!application) {
      return res.status(404).json({
        status: "error",
        message: "Licence application not found",
      });
    }

    const previousAssignment = extractCaseworkerIds(application.assignedcaseworkerId);
    const previousStatus = application.status;

    application.assignedcaseworkerId = caseworkerIds;
    application.status = "Under Review";
    await application.save();

    // Assignment history audit (assign vs reassign).
    await recordLicenceAudit({
      tenantDb: req.tenantDb,
      application,
      actorId: req.user?.userId ?? null,
      action:
        previousAssignment.length > 0
          ? LICENCE_AUDIT_ACTIONS.REASSIGN
          : LICENCE_AUDIT_ACTIONS.ASSIGN,
      previousStatus,
      newStatus: "Under Review",
      assignedCaseworkerIds: caseworkerIds,
      req,
    });

    // Event 3 — Licence Assigned: notify caseworker(s) + sponsor (in-app + email).
    try {
      await sponsorshipNotify.licenceAssigned({
        tenantDb: req.tenantDb,
        application,
        caseworkers: caseworkerIds,
        req,
      });
    } catch (notifyErr) {
      logger.error({ err: notifyErr }, "Failed to send assignment notifications");
    }

    res.status(200).json({
      status: "success",
      message: "Caseworkers assigned successfully",
      data: application,
    });
  } catch (error) {
    logger.error({ err: error }, "Error assigning caseworker to licence");
    res.status(500).json({
      status: "error",
      message: "Failed to assign caseworker",
      error: error.message,
    });
  }
};

export const deleteLicenceApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await req.tenantDb.LicenceApplication.findByPk(id);

    if (!application) {
      return res.status(404).json({
        status: "error",
        message: "Licence application not found",
      });
    }

    await application.destroy(); // Soft delete

    res.status(200).json({
      status: "success",
      message: "Licence application deleted successfully",
    });
  } catch (error) {
    logger.error({ err: error }, "Error deleting licence application");
    res.status(500).json({
      status: "error",
      message: "Failed to delete licence application",
      error: error.message,
    });
  }
};
export const updateLicenceApplicationByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await req.tenantDb.LicenceApplication.findByPk(id);

    if (!application) {
      return res.status(404).json({
        status: "error",
        message: "Licence application not found",
      });
    }

    const updateData = { ...req.body };

    // Sanitize date fields
    if (
      updateData.proposedStartDate === "" ||
      updateData.proposedStartDate === "Invalid date"
    ) {
      updateData.proposedStartDate = null;
    }

    await application.update(updateData);

    res.status(200).json({
      status: "success",
      message: "Licence application updated successfully",
      data: application,
    });
  } catch (error) {
    logger.error({ err: error }, "Error updating licence application by admin");
    res.status(500).json({
      status: "error",
      message: "Failed to update licence application",
      error: error.message,
    });
  }
};

// ─── CoS request review (admin) — backed by the dedicated CosRequest entity ───

export const getCosRequests = async (req, res) => {
  try {
    const requests = await listCosRequests(req.tenantDb, { status: req.query.status });
    res.status(200).json({
      status: "success",
      message: "CoS requests fetched successfully",
      data: requests,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching CoS requests");
    res.status(500).json({ status: "error", message: "Failed to fetch CoS requests", data: null });
  }
};

export const assignCosRequestToCaseworker = async (req, res) => {
  try {
    const { caseworkerIds, adminNotes } = req.body;
    const request = await assignCosRequest({
      tenantDb: req.tenantDb,
      id: req.params.id,
      caseworkerIds,
      adminNotes,
      actorId: req.user?.userId ?? null,
      req,
    });
    res.status(200).json({
      status: "success",
      message: "CoS request assigned to caseworker(s) successfully",
      data: request,
    });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "Error assigning CoS request to caseworker");
    res.status(code).json({ status: "error", message: error.message || "Failed to assign CoS request", data: null });
  }
};

export const approveCosRequest = async (req, res) => {
  try {
    const { approvedAmount, reviewNotes } = req.body;
    const request = await reviewCosRequest({
      tenantDb: req.tenantDb,
      id: req.params.id,
      action: "approve",
      approvedAmount,
      reviewNotes,
      reviewerId: req.user?.userId ?? null,
      req,
    });
    res.status(200).json({ status: "success", message: "CoS request approved", data: request });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "Error approving CoS request");
    res.status(code).json({ status: "error", message: error.message || "Failed to approve CoS request" });
  }
};

export const rejectCosRequest = async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const request = await reviewCosRequest({
      tenantDb: req.tenantDb,
      id: req.params.id,
      action: "reject",
      reviewNotes,
      reviewerId: req.user?.userId ?? null,
      req,
    });
    res.status(200).json({ status: "success", message: "CoS request rejected", data: request });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "Error rejecting CoS request");
    res.status(code).json({ status: "error", message: error.message || "Failed to reject CoS request" });
  }
};
