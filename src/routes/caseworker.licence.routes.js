import { Router } from "express";
import { 
    getAssignedLicenceApplications,
    updateLicenceReviewStatus
} from "../controllers/CaseworkerControllers/caseworkerLicence.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

router.get("/assigned", getAssignedLicenceApplications);
router.patch("/update-status/:id", updateLicenceReviewStatus);

export default router;
