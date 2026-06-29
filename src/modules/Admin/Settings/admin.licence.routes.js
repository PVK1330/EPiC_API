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
    getCosAllocationRecordAdmin,
    getLicenceApplicationV2,
    downloadLicenceDocument,
    verifyAdminAppendixDocument,
    bulkVerifyAdminAppendixDocuments,
    rejectAdminAppendixDocument,
} from './licenceManagement.controller.js';
import {
    getAdminSubmittedCredentials,
    verifyAdminCredentials,
    requestAdminCredentialResubmission,
} from './adminLicenceGovernment.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ADMIN_ROLES } from '../../../middlewares/role.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import { getLicenceStages, completeLicenceStageTask, getLicenceWorkflowTimeline, downloadPaymentProof, downloadDecisionLetter } from '../../Shared/Licence/licenceStage.controller.js';
import {
    createInfoRequestHandler,
    listInfoRequestsHandler,
    getInfoRequestHandler,
    addCommentHandler,
    closeInfoRequestHandler,
} from '../../Shared/Licence/licenceInformationRequest.controller.js';
import {
    grantLicenceHandler,
    rejectLicenceHandler,
    getGrantRecordHandler,
} from '../../Shared/Licence/licenceGrant.controller.js';
import { adminUpdateLicenceSchema } from '../../../validations/licenceApplication.validation.js';
import {
    dispatchDocumentHandler,
    listDispatchDocumentsHandler,
    downloadDispatchDocumentHandler,
} from '../../Shared/Licence/licenceDispatch.controller.js';
import { upload } from '../../../middlewares/upload.middleware.js';

const router = express.Router();

router.use(verifyTokenAndTenant);
router.use(checkRole(ADMIN_ROLES));

router.get("/all", getAllLicenceApplications);
router.get("/v2/:id", getLicenceApplicationV2);
router.get("/details/:id", getAdminLicenceApplicationDetails);
router.get("/:id/documents/:index/download", downloadLicenceDocument);
// Sponsor-uploaded UKVI payment slip (proof attached when confirming the fee payment).
router.get("/:id/payment-proof/download", downloadPaymentProof);
// Sponsor-uploaded UKVI decision/grant letter (attached when confirming the outcome).
router.get("/:id/decision-letter/download", downloadDecisionLetter);

// Stages panel (per-stage, per-role tasks) — admin can view and complete any task.
router.get("/:id/stages", getLicenceStages);
router.post("/:id/stages/:stageKey/complete", completeLicenceStageTask);
router.get("/:id/workflow-timeline", getLicenceWorkflowTimeline);
router.patch("/update-status/:id", updateLicenceApplicationStatus);
router.patch("/request-info/:id", requestAdditionalInformation);
router.post("/assign-caseworker/:id", assignCaseworker);
router.get("/cos-requests", getCosRequests);
router.post("/cos-requests/:id/assign-caseworker", assignCosRequestToCaseworker);
router.patch("/cos-requests/:id/approve", approveCosRequest);
router.patch("/cos-requests/:id/reject", rejectCosRequest);
router.patch("/cos-requests/:id/request-info", requestInfoForCosRequestAdmin);
router.get("/cos-requests/:id/allocation", getCosAllocationRecordAdmin);
router.delete("/delete/:id", deleteLicenceApplication);
router.post("/restore/:id", restoreLicenceApplication);
router.put("/update/:id", validate(adminUpdateLicenceSchema, "adminUpdateLicenceSchema"), updateLicenceApplicationByAdmin);

// Information Request workflow — admin may raise, comment, and close requests.
router.post("/:id/info-requests",                     createInfoRequestHandler);
router.get("/:id/info-requests",                      listInfoRequestsHandler);
router.get("/:id/info-requests/:requestId",           getInfoRequestHandler);
router.post("/:id/info-requests/:requestId/comments", addCommentHandler);
router.patch("/:id/info-requests/:requestId/close",   closeInfoRequestHandler);

// Licence Grant workflow — admin-only; only ADMIN/SUPERADMIN roles may approve.
router.post("/:id/grant",        grantLicenceHandler);
router.post("/:id/reject-final", rejectLicenceHandler);
router.get("/:id/grant-record",  getGrantRecordHandler);

// Appendix A documents — admin verify / reject (same as caseworker but admin-gated).
router.patch("/:id/appendix-documents/:documentId/verify", verifyAdminAppendixDocument);
router.post("/:id/appendix-documents/bulk-verify", bulkVerifyAdminAppendixDocuments);
router.patch("/:id/appendix-documents/:documentId/reject", rejectAdminAppendixDocument);

// Government credentials (flow v2) — the sponsor submits the credentials they
// receive from UKVI; admin only views, verifies, or requests resubmission.
router.get("/:id/submitted-credentials", getAdminSubmittedCredentials);
router.post("/:id/verify-credentials", verifyAdminCredentials);
router.post("/:id/request-credentials-resubmission", requestAdminCredentialResubmission);

// Dispatch documents to sponsor (upload + email + portal).
router.post("/:id/dispatch-document", upload.single("document"), dispatchDocumentHandler);
router.get("/:id/dispatch-documents", listDispatchDocumentsHandler);
router.get("/:id/dispatch-documents/:docId/download", downloadDispatchDocumentHandler);

export default router;
