import { Router } from 'express';
import { 
    getAssignedLicenceApplications,
    updateLicenceReviewStatus
} from '../caseworkerLicence.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

router.get("/assigned", getAssignedLicenceApplications);
router.patch("/update-status/:id", updateLicenceReviewStatus);

export default router;
