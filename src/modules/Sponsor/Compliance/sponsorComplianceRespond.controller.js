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

    // Optional additional evidence file.
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

    await sponsorRespond({
      tenantDb: req.tenantDb,
      cfg,
      record,
      sponsorId,
      notes: req.body?.notes ?? null,
      evidencePath,
      req,
    });

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
