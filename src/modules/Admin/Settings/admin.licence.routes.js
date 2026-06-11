import express from 'express';
import { 
    getAllLicenceApplications, 
    updateLicenceApplicationStatus, 
    getAdminLicenceApplicationDetails,
    requestAdditionalInformation,
    assignCaseworker,
    deleteLicenceApplication,
    updateLicenceApplicationByAdmin,
    getCosRequests,
    assignCosRequestToCaseworker,
    approveCosRequest,
    rejectCosRequest,
    getLicenceApplicationV2
} from './licenceManagement.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = express.Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

router.get("/all", getAllLicenceApplications);
router.get("/v2/:id", getLicenceApplicationV2);
router.get("/details/:id", getAdminLicenceApplicationDetails);
router.patch("/update-status/:id", updateLicenceApplicationStatus);
router.patch("/request-info/:id", requestAdditionalInformation);
router.post("/assign-caseworker/:id", assignCaseworker);
router.get("/cos-requests", getCosRequests);
router.post("/cos-requests/:id/assign-caseworker", assignCosRequestToCaseworker);
router.patch("/cos-requests/:id/approve", approveCosRequest);
router.patch("/cos-requests/:id/reject", rejectCosRequest);
router.delete("/delete/:id", deleteLicenceApplication);
router.put("/update/:id", updateLicenceApplicationByAdmin);

export default router;
