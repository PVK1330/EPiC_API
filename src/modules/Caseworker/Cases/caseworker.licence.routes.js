import { Router } from 'express';
import {
    getAssignedLicenceApplications,
    getMyAssignedDashboard,
    updateLicenceReviewStatus,
    getLicenceApplicationAudit,
    getLicenceApplicationV2Full
} from '../caseworkerLicence.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import { ensureAssignedCaseworker } from '../../../middlewares/ensureAssignedCaseworker.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

// My Assigned Applications dashboard (assigned list + status counts).
router.get("/assigned", getAssignedLicenceApplications);
router.get("/my-assigned", getMyAssignedDashboard);

// Review actions (Approve / Reject / Request Information) — only the assigned
// caseworker (or an admin override) may proceed; anyone else gets HTTP 403.
router.patch("/update-status/:id", ensureAssignedCaseworker(), updateLicenceReviewStatus);

// Full normalized V2 application (read-only) — same assignment access guard.
router.get("/v2/:id", ensureAssignedCaseworker(), getLicenceApplicationV2Full);

// Assignment history + reviewer actions for an application (same access guard).
router.get("/:id/audit", ensureAssignedCaseworker(), getLicenceApplicationAudit);

export default router;
