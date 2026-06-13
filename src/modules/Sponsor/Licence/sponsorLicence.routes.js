import express from 'express';
import {
    submitLicenceApplication,
    getMyLicenceApplications,
    getLicenceApplicationDetails,
    updateLicenceApplication,
    deleteMyLicenceApplication,
    renewLicenceApplication,
    getLicenceDocuments,
    getLicenceSummary,
    uploadLicenceDocument,
    deleteLicenceDocument
} from './sponsorLicence.controller.js';
import { confirmGovernmentCredentialsReceived } from './sponsorLicenceGovernment.controller.js';
import {
    getSponsorIntakeSummary,
    updateSponsorIntakeForm,
    submitSponsorIntakeForm,
    uploadSponsorIntakeDocument,
    deleteSponsorIntakeDocument,
} from './sponsorLicenceIntake.controller.js';
// CoS logic now lives in the single CoS controller/service. These licence-router
// CoS routes are kept as DEPRECATED backward-compatible aliases that delegate to
// the unified CoS handlers (canonical surface: /api/business/cos/*).
import {
    requestCosAllocation,
    getCosRequests,
    updateCosRequest,
    deleteCosRequest
} from './sponsorCos.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { upload } from '../../../middlewares/upload.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import {
  sponsorSubmitLicenceSchema,
  sponsorUpdateLicenceSchema,
} from '../../../validations/licenceApplication.validation.js';
import { requireActiveSponsorLicence } from '../../../middlewares/requireActiveSponsorLicence.middleware.js';
import { downloadLicenceDocument } from '../../Shared/Licence/licenceStage.controller.js';

const router = express.Router();

router.use(verifyTokenAndTenant);

// Stream one of the sponsor's own uploaded documents (ownership-guarded).
router.get("/:id/documents/:index/download", downloadLicenceDocument);

router.post("/apply", upload.array("documents", 10), validate(sponsorSubmitLicenceSchema, "sponsorSubmitLicenceSchema"), submitLicenceApplication);
router.get("/my-applications", getMyLicenceApplications);
router.get("/details/:id", getLicenceApplicationDetails);
router.put("/update/:id", upload.array("documents", 10), validate(sponsorUpdateLicenceSchema, "sponsorUpdateLicenceSchema"), updateLicenceApplication);
router.delete("/delete/:id", deleteMyLicenceApplication);
router.post("/renew/:id", renewLicenceApplication);
router.get("/documents", getLicenceDocuments);
router.get("/summary", getLicenceSummary);
router.post("/documents/upload", upload.array("documents", 10), uploadLicenceDocument);
router.delete("/documents/:applicationId/:docIndex", deleteLicenceDocument);

// Government credentials confirmation (Phase 3).
router.post("/:id/government-credentials", confirmGovernmentCredentialsReceived);

// Intake: information form + document checklist.
router.get("/:id/intake", getSponsorIntakeSummary);
router.put("/:id/intake", updateSponsorIntakeForm);
router.post("/:id/intake/submit", submitSponsorIntakeForm);
router.post("/:id/intake/documents/:documentKey/upload", upload.single("document"), uploadSponsorIntakeDocument);
router.delete("/:id/intake/documents/:documentKey", deleteSponsorIntakeDocument);

// --- Deprecated CoS aliases (use /api/business/cos/* instead) ---
router.patch("/request-more-cos", requireActiveSponsorLicence(), requestCosAllocation);
router.get("/cos-requests", getCosRequests);
router.put("/cos-requests/:id", updateCosRequest);
router.delete("/cos-requests/:id", deleteCosRequest);

export default router;
