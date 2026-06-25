/**
 * Caseworker — Licence Intake Controller
 *
 * Routes handled:
 *   GET  /:id/intake          — view form + document checklist
 *   GET  /:id/intake/readiness — check readiness for government registration
 *   PATCH /:id/intake/documents/:documentKey/verify   — verify a document
 *   PATCH /:id/intake/documents/:documentKey/reject   — reject a document
 *   PATCH /:id/intake/documents/:documentKey/request-info — request more info
 */

import path from "path";
import fs from "fs";
import logger from "../../../utils/logger.js";
import {
  getIntakeSummary,
  checkIntakeReadiness,
  verifyDocument,
  rejectDocument,
  requestDocumentInfo,
  verifyAppendixDocument,
  bulkVerifyAppendixDocuments,
  rejectAppendixDocument,
} from "../../../services/licenceIntake.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApp(req) {
  // ensureAssignedCaseworker middleware attaches the application
  return req.licenceApplication || null;
}

async function resolveApplication(req, res) {
  let app = getApp(req);
  if (!app) {
    app = await req.tenantDb.LicenceApplication.findByPk(req.params.id);
    if (!app) {
      res.status(404).json({ success: false, message: "Application not found" });
      return null;
    }
  }
  return app;
}

// ─── GET /:id/intake ──────────────────────────────────────────────────────────

export async function getCaseworkerIntakeSummary(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.tenantDb;
    const organisationId = req.user?.organisation_id;

    const app = await resolveApplication(req, res);
    if (!app) return;

    const summary = await getIntakeSummary(tenantDb, Number(id), organisationId);

    return res.json({ success: true, data: summary });
  } catch (err) {
    logger.error({ err }, "getCaseworkerIntakeSummary failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── GET /:id/intake/readiness ────────────────────────────────────────────────

export async function getIntakeReadiness(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.tenantDb;

    const { isReady, reasons } = await checkIntakeReadiness(tenantDb, Number(id));

    return res.json({ success: true, data: { isReady, reasons } });
  } catch (err) {
    logger.error({ err }, "getIntakeReadiness failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── PATCH /:id/intake/documents/:documentKey/verify ─────────────────────────

export async function verifyCaseworkerDocument(req, res) {
  try {
    const { id, documentKey } = req.params;
    const { notes } = req.body;
    const tenantDb = req.tenantDb;
    const caseworkerId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    const app = await resolveApplication(req, res);
    if (!app) return;

    const doc = await verifyDocument(tenantDb, Number(id), organisationId, documentKey, caseworkerId, notes, req);

    return res.json({ success: true, message: "Document verified", data: doc });
  } catch (err) {
    logger.error({ err }, "verifyCaseworkerDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── PATCH /:id/intake/documents/:documentKey/reject ─────────────────────────

export async function rejectCaseworkerDocument(req, res) {
  try {
    const { id, documentKey } = req.params;
    const { reason } = req.body;
    const tenantDb = req.tenantDb;
    const caseworkerId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: "Rejection reason is required" });
    }

    const app = await resolveApplication(req, res);
    if (!app) return;

    const doc = await rejectDocument(tenantDb, Number(id), organisationId, documentKey, reason.trim(), caseworkerId, req);

    return res.json({ success: true, message: "Document rejected", data: doc });
  } catch (err) {
    logger.error({ err }, "rejectCaseworkerDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── PATCH /:id/intake/documents/:documentKey/request-info ───────────────────

export async function requestCaseworkerDocumentInfo(req, res) {
  try {
    const { id, documentKey } = req.params;
    const { notes } = req.body;
    const tenantDb = req.tenantDb;
    const caseworkerId = req.user?.userId ?? req.user?.id;
    const organisationId = req.user?.organisation_id;

    if (!notes || !notes.trim()) {
      return res.status(400).json({ success: false, message: "Notes are required when requesting document information" });
    }

    const app = await resolveApplication(req, res);
    if (!app) return;

    const doc = await requestDocumentInfo(tenantDb, Number(id), organisationId, documentKey, notes.trim(), caseworkerId, req);

    return res.json({ success: true, message: "Information requested", data: doc });
  } catch (err) {
    logger.error({ err }, "requestCaseworkerDocumentInfo failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── GET /:id/intake/documents/:documentKey/download ─────────────────────────

const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), "storage/private");
const INLINE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];

export async function downloadCaseworkerIntakeDocument(req, res) {
  try {
    const { id, documentKey } = req.params;
    const tenantDb = req.tenantDb;

    const app = await resolveApplication(req, res);
    if (!app) return;

    const doc = await tenantDb.LicenceIntakeDocument.findOne({
      where: { licenceApplicationId: Number(id), documentKey },
    });

    if (!doc || !doc.filePath) {
      return res.status(404).json({ success: false, message: "Document not found or not yet uploaded" });
    }

    const absolute = path.resolve(String(doc.filePath));
    if (!absolute.startsWith(PRIVATE_STORAGE_DIR + path.sep) && absolute !== PRIVATE_STORAGE_DIR) {
      return res.status(400).json({ success: false, message: "Invalid document path" });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ success: false, message: "File no longer exists on the server" });
    }

    const filename = doc.fileName || path.basename(absolute);
    const ext = path.extname(absolute).toLowerCase();
    const forceDownload = req.query.download === "1";
    const disposition = forceDownload || !INLINE_EXTENSIONS.includes(ext) ? "attachment" : "inline";

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    return res.sendFile(absolute, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ success: false, message: "Error streaming document" });
      }
    });
  } catch (err) {
    logger.error({ err }, "downloadCaseworkerIntakeDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

// ─── Appendix document review (V2 wizard uploads) ────────────────────────────

export async function verifyCaseworkerAppendixDocument(req, res) {
  try {
    const { id, documentId } = req.params;
    const { notes } = req.body;
    const caseworkerId = req.user?.userId ?? req.user?.id;

    const app = await resolveApplication(req, res);
    if (!app) return;

    const doc = await verifyAppendixDocument(req.tenantDb, Number(id), Number(documentId), caseworkerId, notes, req);
    return res.json({ success: true, message: "Appendix document verified", data: doc });
  } catch (err) {
    logger.error({ err }, "verifyCaseworkerAppendixDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

export async function bulkVerifyCaseworkerAppendixDocuments(req, res) {
  try {
    const { id } = req.params;
    const { documentIds, notes } = req.body;
    const caseworkerId = req.user?.userId ?? req.user?.id;

    const app = await resolveApplication(req, res);
    if (!app) return;

    const result = await bulkVerifyAppendixDocuments(req.tenantDb, Number(id), documentIds, caseworkerId, notes, req);
    return res.json({ success: true, message: `${result.verifiedCount} document(s) verified`, data: result });
  } catch (err) {
    logger.error({ err }, "bulkVerifyCaseworkerAppendixDocuments failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}

export async function rejectCaseworkerAppendixDocument(req, res) {
  try {
    const { id, documentId } = req.params;
    const { reason } = req.body;
    const caseworkerId = req.user?.userId ?? req.user?.id;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: "Rejection reason is required" });
    }

    const app = await resolveApplication(req, res);
    if (!app) return;

    const doc = await rejectAppendixDocument(req.tenantDb, Number(id), Number(documentId), reason.trim(), caseworkerId, req);
    return res.json({ success: true, message: "Appendix document rejected", data: doc });
  } catch (err) {
    logger.error({ err }, "rejectCaseworkerAppendixDocument failed");
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
}
