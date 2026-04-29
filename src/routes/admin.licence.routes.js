import express from "express";
import { 
    getAllLicenceApplications, 
    updateLicenceApplicationStatus, 
    getAdminLicenceApplicationDetails,
    requestAdditionalInformation,
    assignCaseworker,
    deleteLicenceApplication,
    updateLicenceApplicationByAdmin
} from "../controllers/AdminControllers/licenceManagement.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = express.Router();

router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]));

router.get("/all", getAllLicenceApplications);
router.get("/details/:id", getAdminLicenceApplicationDetails);
router.patch("/update-status/:id", updateLicenceApplicationStatus);
router.patch("/request-info/:id", requestAdditionalInformation);
router.post("/assign-caseworker/:id", assignCaseworker);
router.delete("/delete/:id", deleteLicenceApplication);
router.put("/update/:id", updateLicenceApplicationByAdmin);

export default router;
