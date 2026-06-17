/**
 * Sponsor — Licence Intake Controller
 *
 * Routes handled:
 *   GET  /:id/intake                  — view form + document checklist
 *   PUT  /:id/intake                  — save / update information form
 *   POST /:id/intake/submit           — mark information form complete
 *   POST /:id/intake/documents/:documentKey/upload  — upload a document file
 *   DELETE /:id/intake/documents/:documentKey       — remove uploaded file
 */

import path from "path";
import logger from "../../../utils/logger.js";
import {
  getIntakeSummary,
  updateIntakeForm,
  submitIntakeForm,
  seedAllDocuments,
  recordDocumentUpload,
} from "../../../services/licenceIntake.service.js";
import { recordAuditLog } from "../../../services/audit.service.js";

// ─── Helper: resolve application (owner-guarded) ──────────────────────────────

async function resolveOwnedApplication(req, res) {
  const { id } = req.params;
  const userId = req.user?.userId ?? req.user?.id;
  const tenantDb = req.tenantDb;

  const app = await tenantDb.LicenceApplication.findOne({
    where: { id: Number(id), userId },
  });

  if (!app) {
    res.status(404).json({ success: false, message: "Application not found or access denied" });
    return null;
  }

  return app;
}

// ─── GET /:id/intake ──────────────────────────────────────────────────────────

export async function getSponsorIntakeSummary(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.tenantDb;
    const organisationId = req.user?.organisation_id;

    const app = await resolveOwnedApplication(req, res);
    if (!app) return;

    const summary = await getIntakeSummary(tenantDb, Number(id), organisationId);

    return res.json({ success: true, data: summary });
  } catch (err) {
    logger.error({ err }, "getSponsorIntakeSummary failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── PUT /:id/intake ──────────────────────────────────────────────────────────

export async function updateSponsorIntakeForm(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.tenantDb;
    const userId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    const app = await resolveOwnedApplication(req, res);
    if (!app) return;

    // Seed the mandatory document checklist lazily on first form save
    await seedAllDocuments(tenantDb, Number(id), organisationId);

    const form = await updateIntakeForm(tenantDb, Number(id), organisationId, req.body, userId);

    return res.json({ success: true, message: "Intake form saved", data: form });
  } catch (err) {
    logger.error({ err }, "updateSponsorIntakeForm failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── POST /:id/intake/submit ──────────────────────────────────────────────────

export async function submitSponsorIntakeForm(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.tenantDb;
    const userId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    const app = await resolveOwnedApplication(req, res);
    if (!app) return;

    const result = await submitIntakeForm(tenantDb, Number(id), organisationId, userId, req);

    if (!result.ok) {
      return res.status(422).json({
        success: false,
        message: "Some required fields are missing",
        missing: result.missing,
      });
    }

    return res.json({ success: true, message: "Intake form submitted successfully", data: result.form });
  } catch (err) {
    logger.error({ err }, "submitSponsorIntakeForm failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── POST /:id/intake/documents/:documentKey/upload ───────────────────────────

export async function uploadSponsorIntakeDocument(req, res) {
  try {
    const { id, documentKey } = req.params;
    const tenantDb = req.tenantDb;
    const userId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    const app = await resolveOwnedApplication(req, res);
    if (!app) return;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const file = req.file;
    const fileData = {
      fileName: file.originalname || path.basename(file.path || file.filename || ""),
      filePath: file.path || file.location || file.key || file.filename || "",
      fileMimeType: file.mimetype || null,
      fileSizeBytes: file.size || null,
    };

    const doc = await recordDocumentUpload(tenantDb, Number(id), organisationId, documentKey, fileData, userId, req);

    return res.json({ success: true, message: "Document uploaded", data: doc });
  } catch (err) {
    logger.error({ err }, "uploadSponsorIntakeDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── DELETE /:id/intake/documents/:documentKey ────────────────────────────────

export async function deleteSponsorIntakeDocument(req, res) {
  try {
    const { id, documentKey } = req.params;
    const tenantDb = req.tenantDb;
    const userId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    const app = await resolveOwnedApplication(req, res);
    if (!app) return;

    const doc = await tenantDb.LicenceIntakeDocument.findOne({
      where: { licenceApplicationId: Number(id), documentKey },
    });

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found in checklist" });
    }

    if (doc.status === "verified") {
      return res.status(400).json({ success: false, message: "Cannot remove a verified document" });
    }

    // Clear file fields and reset to pending
    doc.fileName = null;
    doc.filePath = null;
    doc.fileMimeType = null;
    doc.fileSizeBytes = null;
    doc.status = "pending";
    doc.uploadedAt = null;
    doc.uploadedByUserId = null;
    doc.source = "manual";
    doc.sourceAppendixDocumentId = null;
    doc.rejectionReason = null;
    doc.caseworkerNotes = null;
    await doc.save();

    await recordAuditLog({
      tenantDb,
      userId,
      action: "INTAKE_DOCUMENT_REMOVED",
      resource: `LicenceApplication:${id}`,
      status: "Success",
      details: `Sponsor removed uploaded file for document "${doc.documentName}" (key: ${documentKey})`,
      req,
      organisationId,
    });

    return res.json({ success: true, message: "Document file removed", data: doc });
  } catch (err) {
    logger.error({ err }, "deleteSponsorIntakeDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}
