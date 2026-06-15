import express from 'express';
import {
    getAllLicenceApplications,
    updateLicenceApplicationStatus,
    getAdminLicenceApplicationDetails,
    requestAdditionalInformation,
    assignCaseworker,
    deleteLicenceApplication,
    restoreLicenceApplication,
    updateLicenceApplicationByAdmin,
    getCosRequests,
    assignCosRequestToCaseworker,
    approveCosRequest,
    rejectCosRequest,
    requestInfoForCosRequestAdmin,
    getLicenceApplicationV2,
    downloadLicenceDocument,
    verifyAdminAppendixDocument,
    rejectAdminAppendixDocument,
} from './licenceManagement.controller.js';
import {
    generateLicenceCredentials,
    resendLicenceCredentials,
} from './adminLicenceGovernment.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ADMIN_ROLES } from '../../../middlewares/role.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import { getLicenceStages, completeLicenceStageTask } from '../../Shared/Licence/licenceStage.controller.js';
import { generateCredentialsSchema } from '../../../validations/licenceGovernment.validation.js';
import { adminUpdateLicenceSchema } from '../../../validations/licenceApplication.validation.js';

const router = express.Router();

router.use(verifyTokenAndTenant);
router.use(checkRole(ADMIN_ROLES));

router.get("/all", getAllLicenceApplications);
router.get("/v2/:id", getLicenceApplicationV2);
router.get("/details/:id", getAdminLicenceApplicationDetails);
router.get("/:id/documents/:index/download", downloadLicenceDocument);

// Stages panel (per-stage, per-role tasks) — admin can view and complete any task.
router.get("/:id/stages", getLicenceStages);
router.post("/:id/stages/:stageKey/complete", completeLicenceStageTask);
router.patch("/update-status/:id", updateLicenceApplicationStatus);
router.patch("/request-info/:id", requestAdditionalInformation);
router.post("/assign-caseworker/:id", assignCaseworker);
router.get("/cos-requests", getCosRequests);
router.post("/cos-requests/:id/assign-caseworker", assignCosRequestToCaseworker);
router.patch("/cos-requests/:id/approve", approveCosRequest);
router.patch("/cos-requests/:id/reject", rejectCosRequest);
router.patch("/cos-requests/:id/request-info", requestInfoForCosRequestAdmin);
router.delete("/delete/:id", deleteLicenceApplication);
router.post("/restore/:id", restoreLicenceApplication);
router.put("/update/:id", validate(adminUpdateLicenceSchema, "adminUpdateLicenceSchema"), updateLicenceApplicationByAdmin);

// Appendix A documents — admin verify / reject (same as caseworker but admin-gated).
router.patch("/:id/appendix-documents/:documentId/verify", verifyAdminAppendixDocument);
router.patch("/:id/appendix-documents/:documentId/reject", rejectAdminAppendixDocument);

// Government credential management (Phase 3).
router.post("/:id/generate-credentials", validate(generateCredentialsSchema), generateLicenceCredentials);
router.post("/:id/resend-credentials", resendLicenceCredentials);

export default router;
