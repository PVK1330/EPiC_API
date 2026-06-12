import path from "path";
import fs from "fs";
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
  requestInfoCosRequest,
} from "../../../services/cosRequest.service.js";
import * as sponsorshipNotify from "../../../services/sponsorshipNotification.service.js";
import { ensureStageTasks } from "../../../services/licenceStageTask.service.js";
import { resolveLicenceDocumentPaths } from "../../../utils/licenceDocuments.util.js";
import { validateTransition, WORKFLOW_TYPES } from "../../../services/workflowEngine.service.js";

// Licence documents are stored as raw disk paths in LicenceApplication.documents
// (e.g. storage/private/temp/<uuid>.pdf). The /uploads dir is no longer served
// statically, so reviewers must stream each file through this authenticated route.
const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), "storage/private");
const INLINE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];

/** GET /api/admin/licence/:id/documents/:index/download — stream one licence doc. */
export const downloadLicenceDocument = async (req, res) => {
  try {
    const { id, index } = req.params;

    const application = await req.tenantDb.LicenceApplication.findByPk(id);
    if (!application) {
      return res.status(404).json({ status: "error", message: "Licence application not found" });
    }

    // V2-aware: merge V1 JSON `documents` with V2 `licence_appendix_documents`
    // file paths so reviewers can view/download evidence from both versions.
    const docs = await resolveLicenceDocumentPaths(req.tenantDb, application);
    const i = Number.parseInt(index, 10);
    if (Number.isNaN(i) || i < 0 || i >= docs.length || !docs[i]) {
      return res.status(404).json({ status: "error", message: "Document not found" });
    }

    // Resolve to an absolute path and confine it strictly to storage/private to
    // block directory-traversal. Stored paths may be absolute (newer uploads) or
    // relative to cwd (legacy); path.resolve handles both.
    const absolute = path.resolve(String(docs[i]));
    if (absolute !== PRIVATE_STORAGE_DIR && !absolute.startsWith(PRIVATE_STORAGE_DIR + path.sep)) {
      return res.status(400).json({ status: "error", message: "Invalid document path" });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ status: "error", message: "File no longer exists on the server" });
    }

    const filename = path.basename(absolute);
    const ext = path.extname(filename).toLowerCase();
    // Inline-preview safe types unless the caller explicitly wants a download.
    const forceDownload = req.query.download === "1";
    const disposition = forceDownload || !INLINE_EXTENSIONS.includes(ext) ? "attachment" : "inline";

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);

    return res.sendFile(absolute, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ status: "error", message: "Error streaming document" });
      }
    });
  } catch (error) {
    logger.error({ err: error }, "Error downloading licence document");
    if (!res.headersSent) {
      res.status(500).json({ status: "error", message: "Failed to download document" });
    }
  }
};

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
        {
          model: req.tenantDb.LicenceGovernmentTracking,
          as: "governmentTracking",
          required: false,
          // Never return the encrypted password to the frontend.
          attributes: [
            "id", "ukviPortalUserId", "smsPortalUsername", "smsRegistrationRef",
            "credentialsGeneratedAt", "credentialsSentAt",
            "governmentRegistrationRef", "governmentSubmissionRef", "governmentSubmissionDate",
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // V2-aware: merge V2 appendix evidence into each app's documents array so the
    // reviewer document list is populated for V2 applications too (not just V1).
    const data = await Promise.all(
      applications.map(async (app) => {
        const plain = app.toJSON();
        plain.documents = await resolveLicenceDocumentPaths(req.tenantDb, app);
        return plain;
      })
    );

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching all licence applications");
    res.status(500).json({
      status: "error",
      message: "Failed to fetch licence applications",
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

    const transitionCheck = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, status);
    if (!transitionCheck.valid) {
      return res.status(400).json({ status: "error", message: transitionCheck.message });
    }

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
        previousStatus,
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

    // Re-sync the stage tasks (e.g. Approved → all stages complete; status drives
    // which stage is current). Best-effort — never blocks the response.
    try {
      await ensureStageTasks(req.tenantDb, application, { req });
    } catch (err) {
      logger.error({ err }, "ensureStageTasks failed on status update");
    }

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
    logger.error({ err: error }, "Error fetching licence application details for admin");
    res.status(500).json({
      status: "error",
      message: "Failed to fetch licence application details",
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

    const transitionCheck = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Information Requested");
    if (!transitionCheck.valid) {
      return res.status(400).json({ status: "error", message: transitionCheck.message });
    }

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

    const transitionCheck = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, "Under Review");
    if (!transitionCheck.valid) {
      return res.status(400).json({ status: "error", message: transitionCheck.message });
    }

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

    // Sync the caseworker's stage-task assignments to the newly assigned reviewer(s).
    try {
      await ensureStageTasks(req.tenantDb, application, { req });
    } catch (err) {
      logger.error({ err }, "ensureStageTasks failed on caseworker assignment");
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

    // req.body has already been stripped to the adminUpdateLicenceSchema whitelist
    // by validate() middleware — only explicitly-allowed fields reach here.
    // The date transform in the schema has also normalised "" / "Invalid date" → null.
    const updateData = { ...req.body };

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
    res.status(code).json({ status: "error", message: code < 500 ? (error.message || "Failed to assign CoS request") : "Failed to assign CoS request", data: null });
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
    res.status(code).json({ status: "error", message: code < 500 ? (error.message || "Failed to approve CoS request") : "Failed to approve CoS request" });
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
    res.status(code).json({ status: "error", message: code < 500 ? (error.message || "Failed to reject CoS request") : "Failed to reject CoS request" });
  }
};

export const requestInfoForCosRequestAdmin = async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const request = await requestInfoCosRequest({
      tenantDb: req.tenantDb,
      id: req.params.id,
      reviewNotes,
      reviewerId: req.user?.userId ?? null,
      req,
    });
    res.status(200).json({ status: "success", message: "Information requested from sponsor", data: request });
  } catch (error) {
    const code = error?.statusCode || 500;
    if (code >= 500) logger.error({ err: error }, "Error requesting CoS information");
    res.status(code).json({ status: "error", message: code < 500 ? (error.message || "Failed to request information") : "Failed to request information" });
  }
};
