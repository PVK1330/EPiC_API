import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, STAFF_ROLES } from "../../../middlewares/role.middleware.js";
import { ensureAssignedCaseworker } from "./ensureAssignedCaseworker.middleware.js";
import {
  getMyAssignedCosRequests,
  approveAssignedCosRequest,
  rejectAssignedCosRequest,
  requestInfoForCosRequest,
  getCosAllocationRecordHandler,
} from "./caseworkerCos.controller.js";

const router = Router();

router.use(verifyTokenAndTenant);
// STAFF_ROLES = [CASEWORKER, ADMIN, SUPERADMIN] — adds missing SUPERADMIN (ISSUE-014).
router.use(checkRole(STAFF_ROLES));

// CoS requests assigned to me (the caseworker).
router.get("/assigned", getMyAssignedCosRequests);

// Mutation routes: ensureAssignedCaseworker confirms the caller is an admin/superadmin
// or is listed in CosRequest.assignedCaseworkerIds before the handler runs (ISSUE-014).
router.patch("/:id/approve",      ensureAssignedCaseworker, approveAssignedCosRequest);
router.patch("/:id/reject",       ensureAssignedCaseworker, rejectAssignedCosRequest);
router.patch("/:id/request-info", ensureAssignedCaseworker, requestInfoForCosRequest);

// Allocation record — view after approval.
router.get("/:id/allocation", getCosAllocationRecordHandler);

export default router;
