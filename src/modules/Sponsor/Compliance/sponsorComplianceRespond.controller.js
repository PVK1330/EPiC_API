import path from "path";
import fs from "fs";
import logger from "../../../utils/logger.js";
import {
  resolveEntity,
  sponsorRespond,
} from "../../../services/complianceReview.service.js";

/**
 * Sponsor responds to an "Information Requested" review, optionally uploading
 * additional evidence. Scoped to the sponsor's own records.
 */
export const respondToComplianceReview = async (req, res) => {
  try {
    const cfg = resolveEntity(req.params.entityType);
    const sponsorId = req.user.userId;

    const record = await req.tenantDb[cfg.model].findOne({
      where: { id: req.params.id, sponsorId },
    });
    if (!record) {
      return res.status(404).json({ status: "error", message: "Record not found" });
    }

    // D-1 fix: copy the file to its permanent location BEFORE calling
    // sponsorRespond so that the evidence path and the reviewStatus change are
    // written to the DB in one atomic record.save() inside the service.
    // If the service guard rejects the request (wrong reviewStatus), we delete
    // the already-copied permanent file in the catch block — no orphan files
    // and no split-write inconsistency.
    let evidencePath = null;
    if (req.file) {
      const targetDir = path.join("uploads", "business", String(sponsorId), "compliance-evidence");
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const targetPath = path.join(targetDir, fileName);
      fs.copyFileSync(req.file.path, targetPath);
      fs.unlinkSync(req.file.path);
      evidencePath = targetPath.replace(/\\/g, "/");
    }

    try {
      // sponsorRespond does `if (evidencePath) record[field] = path` + one
      // record.save() — status change and evidence path are committed together.
      await sponsorRespond({
        tenantDb: req.tenantDb,
        cfg,
        record,
        sponsorId,
        notes: req.body?.notes ?? null,
        evidencePath,
        req,
      });
    } catch (serviceErr) {
      // Guard failed — delete the permanent file we just wrote so nothing is
      // left on disk for a request that was ultimately rejected.
      if (evidencePath) {
        try { fs.unlinkSync(evidencePath); } catch (_) {}
      }
      throw serviceErr;
    }

    res.status(200).json({
      status: "success",
      message: "Response submitted for re-review",
      data: record,
    });
  } catch (err) {
    const code = err?.statusCode || 500;
    if (code >= 500) logger.error({ err }, "Failed to submit compliance response");
    res.status(code).json({ status: "error", message: err.message || "Failed to submit response" });
  }
};
