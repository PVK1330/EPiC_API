import { Router } from "express";
import { upload } from "../../../middlewares/upload.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { respondToComplianceReview } from "./sponsorComplianceRespond.controller.js";
import { sponsorRespondSchema } from "../../../validations/complianceReview.validation.js";

const router = Router();

// Mounted under /api/business/compliance-review — the parent sponsor router
// already enforces authentication + BUSINESS role. Sponsors respond to an
// information request (optionally attaching new evidence) which re-submits the
// item for review.
router.post(
  "/:entityType/:id/respond",
  upload.single("evidence"),
  validate(sponsorRespondSchema, "sponsorComplianceRespond"),
  respondToComplianceReview
);

export default router;
