import path from "path";
import fs from "fs";
import logger from "../../../utils/logger.js";
import {
  createDraft as createDraftSvc,
  saveDraft as saveDraftSvc,
  submitApplication as submitSvc,
  loadFullApplication,
  serializeApplication,
  APPLICATION_VERSION_V2,
  syncPersonnelFromProfile as syncSvc,
} from "../../../services/licenceApplicationV2.service.js";
import { validateForSubmission } from "../../../validations/licenceApplicationV2.validation.js";
import { computeFee } from "../../../services/licenceFee.service.js";
import { recordLicenceAudit, getLicenceAuditTrail } from "../../../services/licenceAssignment.service.js";
import * as sponsorshipNotify from "../../../services/sponsorshipNotification.service.js";
import { ensureStageTasks } from "../../../services/licenceStageTask.service.js";

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};
const orgId = (req) => {
  const n = Number(req.user?.organisation_id);
  return Number.isInteger(n) ? n : null;
};

const EDITABLE = ["Draft", "Information Requested"];

/** POST /api/business/licence/v2/applications — start a new draft. */
export const createDraft = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await createDraftSvc({ tenantDb: req.tenantDb, userId, organisationId: orgId(req) });
    await syncSvc(req.tenantDb, app.id, userId);
    const full = await loadFullApplication(req.tenantDb, app.id, { ownerUserId: userId });
    return res.status(201).json({ status: "success", data: serializeApplication(full) });
  } catch (error) {
    const code = error.statusCode || 500;
    if (code < 500) logger.info({ err: error }, "createDraft (licence v2) blocked");
    else logger.error({ err: error }, "createDraft (licence v2) failed");
    return res.status(code).json({ status: "error", message: error.message || "Failed to create draft application" });
  }
};

/** GET /api/business/licence/v2/applications — list my V2 applications. */
export const listMyApplications = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const apps = await req.tenantDb.LicenceApplication.findAll({
      where: { userId, applicationVersion: APPLICATION_VERSION_V2 },
      order: [["updatedAt", "DESC"]],
      attributes: ["id", "applicationVersion", "status", "type", "currentStep", "companyName", "licenceType", "submittedAt", "feeTotal", "feeCurrency", "createdAt", "updatedAt"],
    });
    return res.status(200).json({ status: "success", data: apps });
  } catch (error) {
    logger.error({ err: error }, "listMyApplications (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to list applications" });
  }
};

/** GET /api/business/licence/v2/applications/:id — full normalized graph (owner). */
export const getApplication = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await loadFullApplication(req.tenantDb, req.params.id, { ownerUserId: userId });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    return res.status(200).json({ status: "success", data: serializeApplication(app) });
  } catch (error) {
    logger.error({ err: error }, "getApplication (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to fetch application" });
  }
};

/** PUT /api/business/licence/v2/applications/:id — save draft (partial). */
export const saveDraft = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId, applicationVersion: APPLICATION_VERSION_V2 },
    });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    if (!EDITABLE.includes(app.status)) {
      return res.status(409).json({ status: "error", message: `A ${app.status} application can no longer be edited.` });
    }
    const updated = await saveDraftSvc({
      tenantDb: req.tenantDb,
      application: app,
      body: req.validated.body,
      organisationId: orgId(req),
    });
    return res.status(200).json({ status: "success", data: serializeApplication(updated) });
  } catch (error) {
    logger.error({ err: error }, "saveDraft (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to save draft" });
  }
};

/** POST /api/business/licence/v2/applications/:id/submit — validate + submit. */
export const submitApplication = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await loadFullApplication(req.tenantDb, req.params.id, { ownerUserId: userId });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    if (!EDITABLE.includes(app.status)) {
      return res.status(409).json({ status: "error", message: `A ${app.status} application cannot be submitted.` });
    }

    const errors = validateForSubmission(serializeApplication(app));
    if (errors.length) {
      return res.status(422).json({ status: "error", message: "Application is incomplete", errors });
    }

    const previousStatus = app.status;
    const submitted = await submitSvc({ tenantDb: req.tenantDb, application: app });

    // Reuse the existing notification + audit pipeline (Event 2 — Licence Submitted).
    try {
      await sponsorshipNotify.licenceSubmitted({ tenantDb: req.tenantDb, application: submitted, req });
    } catch (err) {
      logger.error({ err }, "licenceSubmitted notification failed (v2)");
    }
    await recordLicenceAudit({
      tenantDb: req.tenantDb,
      application: submitted,
      actorId: userId,
      action: "SUBMIT",
      previousStatus,
      newStatus: submitted.status,
      notes: null,
      req,
    });

    // Seed the per-stage, per-role task assignments behind the stages panel.
    try {
      await ensureStageTasks(req.tenantDb, submitted, { req });
    } catch (err) {
      logger.error({ err }, "ensureStageTasks failed on submit (v2)");
    }

    // Assign a post-submission action task to the sponsor so it appears in
    // their task list (BusinessTasks page) prompting them to fill in the
    // Sponsor Information Form and upload their intake documents.
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 5);
      await req.tenantDb.Task.create({
        title: `Complete Sponsor Information Form and upload intake documents for Licence Application #${submitted.id}`,
        assigned_to: userId,
        case_id: null,
        priority: "high",
        status: "pending",
        due_date: dueDate.toISOString().slice(0, 10),
        created_by: userId,
      });
    } catch (err) {
      logger.error({ err }, "Failed to create post-submission sponsor task");
    }

    return res.status(200).json({ status: "success", message: "Application submitted", data: serializeApplication(submitted) });
  } catch (error) {
    const code = error.statusCode || 500;
    if (code < 500) logger.info({ err: error }, "submitApplication (licence v2) blocked");
    else logger.error({ err: error }, "submitApplication (licence v2) failed");
    return res.status(code).json({ status: "error", message: error.message || "Failed to submit application" });
  }
};

/** POST /api/business/licence/v2/applications/:id/appendix-documents/:docId/file */
export const uploadAppendixDocument = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId, applicationVersion: APPLICATION_VERSION_V2 },
    });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    if (!EDITABLE.includes(app.status)) {
      return res.status(409).json({ status: "error", message: `A ${app.status} application can no longer be edited.` });
    }
    const doc = await req.tenantDb.LicenceAppendixDocument.findOne({
      where: { id: req.params.docId, licenceApplicationId: app.id },
    });
    if (!doc) return res.status(404).json({ status: "error", message: "Document not found" });
    const filePath = req.file ? req.file.path.replace(/\\/g, "/") : null;
    if (!filePath) return res.status(400).json({ status: "error", message: "No file uploaded" });

    await doc.update({ filePath, receivedStatus: "Received", verificationStatus: "Pending" });
    return res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    logger.error({ err: error }, "uploadAppendixDocument (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to upload document" });
  }
};

/** GET /api/business/licence/v2/applications/:id/appendix-documents/:docId/file — preview own file. */
const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), "storage/private");
const INLINE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"]);

export const previewAppendixDocument = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId, applicationVersion: APPLICATION_VERSION_V2 },
      attributes: ["id"],
    });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });

    const doc = await req.tenantDb.LicenceAppendixDocument.findOne({
      where: { id: req.params.docId, licenceApplicationId: app.id },
      attributes: ["filePath"],
    });
    if (!doc?.filePath) return res.status(404).json({ status: "error", message: "Document not found" });

    const absolute = path.resolve(String(doc.filePath));
    if (absolute !== PRIVATE_STORAGE_DIR && !absolute.startsWith(PRIVATE_STORAGE_DIR + path.sep)) {
      return res.status(400).json({ status: "error", message: "Invalid document path" });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ status: "error", message: "File not found on server" });
    }

    const filename = path.basename(absolute);
    const ext = path.extname(filename).toLowerCase();
    const disposition = INLINE_EXTS.has(ext) ? "inline" : "attachment";
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
    return res.sendFile(absolute, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ status: "error", message: "Error streaming document" });
      }
    });
  } catch (error) {
    logger.error({ err: error }, "previewAppendixDocument failed");
    if (!res.headersSent) res.status(500).json({ status: "error", message: "Failed to preview document" });
  }
};

/** DELETE /api/business/licence/v2/applications/:id — delete own draft. */
export const deleteDraft = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId, applicationVersion: APPLICATION_VERSION_V2 },
    });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    if (app.status !== "Draft") {
      return res.status(409).json({ status: "error", message: "Only draft applications can be deleted." });
    }
    await app.destroy(); // child rows cascade
    return res.status(200).json({ status: "success", message: "Draft deleted" });
  } catch (error) {
    logger.error({ err: error }, "deleteDraft (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to delete draft" });
  }
};

/** GET /api/business/licence/v2/applications/:id/audit-trail — immutable event history. */
export const getApplicationAuditTrail = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    // Ownership: sponsors may only read the trail for their own application.
    const app = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId },
      attributes: ["id"],
    });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    const entries = await getLicenceAuditTrail(req.tenantDb, app.id);
    return res.status(200).json({ status: "success", data: entries });
  } catch (error) {
    logger.error({ err: error }, "getApplicationAuditTrail (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to fetch audit trail" });
  }
};

/** POST /api/business/licence/v2/fee/preview — stateless fee calculation. */
export const feePreview = async (req, res) => {
  try {
    const { routes, sponsorSize, charityStatus, cosRequirements } = req.validated.body;
    const fee = computeFee({ routes, sponsorSize, charityStatus, cosRequirements });
    return res.status(200).json({ status: "success", data: fee });
  } catch (error) {
    logger.error({ err: error }, "feePreview (licence v2) failed");
    return res.status(500).json({ status: "error", message: "Failed to calculate fee" });
  }
};

/** POST /api/business/licence/v2/applications/:id/sync-from-profile */
export const syncFromProfile = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: "error", message: "Invalid session" });
    const app = await req.tenantDb.LicenceApplication.findOne({
      where: { id: req.params.id, userId, applicationVersion: APPLICATION_VERSION_V2 },
    });
    if (!app) return res.status(404).json({ status: "error", message: "Application not found" });
    if (!EDITABLE.includes(app.status)) {
      return res.status(409).json({ status: "error", message: `A ${app.status} application can no longer be edited.` });
    }

    const updated = await syncSvc(req.tenantDb, app.id, userId);
    return res.status(200).json({ status: "success", message: "Profile data synced successfully", data: serializeApplication(updated) });
  } catch (error) {
    logger.error({ err: error }, "syncFromProfile failed");
    return res.status(500).json({ status: "error", message: error.message || "Failed to sync profile data" });
  }
};
