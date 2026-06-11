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
import { requireActiveSponsorLicence } from '../../../middlewares/requireActiveSponsorLicence.middleware.js';
import { downloadLicenceDocument } from '../../Shared/Licence/licenceStage.controller.js';

const router = express.Router();

router.use(verifyTokenAndTenant);

// Stream one of the sponsor's own uploaded documents (ownership-guarded).
router.get("/:id/documents/:index/download", downloadLicenceDocument);

router.post("/apply", upload.array("documents", 10), submitLicenceApplication);
router.get("/my-applications", getMyLicenceApplications);
router.get("/details/:id", getLicenceApplicationDetails);
router.put("/update/:id", upload.array("documents", 10), updateLicenceApplication);
router.delete("/delete/:id", deleteMyLicenceApplication);
router.post("/renew/:id", renewLicenceApplication);
router.get("/documents", getLicenceDocuments);
router.get("/summary", getLicenceSummary);
router.post("/documents/upload", upload.array("documents", 10), uploadLicenceDocument);
router.delete("/documents/:applicationId/:docIndex", deleteLicenceDocument);

// --- Deprecated CoS aliases (use /api/business/cos/* instead) ---
router.patch("/request-more-cos", requireActiveSponsorLicence(), requestCosAllocation);
router.get("/cos-requests", getCosRequests);
router.put("/cos-requests/:id", updateCosRequest);
router.delete("/cos-requests/:id", deleteCosRequest);

export default router;
