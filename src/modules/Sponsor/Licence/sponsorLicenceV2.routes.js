import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
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
  getApplicationAuditTrail,
  syncFromProfile,
} from "./sponsorLicenceV2.controller.js";
import { getLicenceStages, completeLicenceStageTask, getLicenceWorkflowTimeline } from "../../Shared/Licence/licenceStage.controller.js";
import {
  listInfoRequestsHandler,
  getInfoRequestHandler,
  addCommentHandler,
  sponsorRespondHandler,
} from "../../Shared/Licence/licenceInformationRequest.controller.js";

// Mounted at /api/business/licence/v2. The parent Sponsor router already applies
// verifyTokenAndTenant + checkRole([ROLES.BUSINESS]); the router-level guards below
// are defence-in-depth so this file is safe when mounted independently (ISSUE-012).
const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.BUSINESS]));

router.post("/fee/preview", validate(feePreviewSchema), feePreview);

router.get("/applications", listMyApplications);
router.post("/applications", createDraft);
router.get("/applications/:id", getApplication);
router.put("/applications/:id", validate(saveDraftSchema), saveDraft);
router.delete("/applications/:id", deleteDraft);
router.post("/applications/:id/submit", submitApplication);
router.post("/applications/:id/sync-from-profile", syncFromProfile);
router.post("/applications/:id/appendix-documents/:docId/file", upload.single("file"), uploadAppendixDocument);

// Audit trail — immutable event history for the Timeline tab.
router.get("/applications/:id/audit-trail", getApplicationAuditTrail);

// Full cross-entity workflow timeline (licence + CoS + workers) for the owner.
router.get("/applications/:id/workflow-timeline", getLicenceWorkflowTimeline);

// Stages panel — the owning sponsor views their lifecycle and completes their tasks.
router.get("/applications/:id/stages", getLicenceStages);
router.post("/applications/:id/stages/:stageKey/complete", completeLicenceStageTask);

// Information Requests — sponsor views open requests and submits responses.
router.get("/applications/:id/info-requests",                           listInfoRequestsHandler);
router.get("/applications/:id/info-requests/:requestId",                getInfoRequestHandler);
router.post("/applications/:id/info-requests/:requestId/respond",       sponsorRespondHandler);
router.post("/applications/:id/info-requests/:requestId/comments",      addCommentHandler);

export default router;
