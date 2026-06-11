import { Router } from "express";
import { upload } from "../../../middlewares/upload.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { saveDraftSchema, feePreviewSchema } from "../../../validations/licenceApplicationV2.validation.js";
import {
  createDraft,
  listMyApplications,
  getApplication,
  saveDraft,
  submitApplication,
  uploadAppendixDocument,
  deleteDraft,
  feePreview,
} from "./sponsorLicenceV2.controller.js";
import { getLicenceStages, completeLicenceStageTask } from "../../Shared/Licence/licenceStage.controller.js";

// Mounted at /api/business/licence/v2 (auth + BUSINESS role applied by the parent
// Sponsor router). Sponsor Licence Application V2 — 8-step wizard with drafts.
const router = Router();

router.post("/fee/preview", validate(feePreviewSchema), feePreview);

router.get("/applications", listMyApplications);
router.post("/applications", createDraft);
router.get("/applications/:id", getApplication);
router.put("/applications/:id", validate(saveDraftSchema), saveDraft);
router.delete("/applications/:id", deleteDraft);
router.post("/applications/:id/submit", submitApplication);
router.post("/applications/:id/appendix-documents/:docId/file", upload.single("file"), uploadAppendixDocument);

// Stages panel — the owning sponsor views their lifecycle and completes their tasks.
router.get("/applications/:id/stages", getLicenceStages);
router.post("/applications/:id/stages/:stageKey/complete", completeLicenceStageTask);

export default router;
