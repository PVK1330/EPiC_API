import { Router } from "express";
import {
  getMyWorkers,
  getWorkerHandler,
  createWorkerHandler,
  advanceStageHandler,
  grantVisaHandler,
  rejectVisaHandler,
  assignCaseworkersHandler,
  getAuditTrailHandler,
} from "./caseworkerWorker.controller.js";
import { ensureAssignedWorkerCaseworker } from "../../../middlewares/ensureAssignedWorkerCaseworker.middleware.js";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, STAFF_ROLES } from "../../../middlewares/role.middleware.js";

const router = Router();

// SECURITY (BUG-003): this router was previously mounted with NO authentication
// or role guard, so requests reached the controllers unauthenticated (500 on a
// null req.user/req.tenantDb instead of 401). Restore the standard stack:
// authenticate + attach tenant DB, then restrict to staff (caseworker/admin/
// superadmin). Per-worker assignment checks still run via
// ensureAssignedWorkerCaseworker on the :id routes.
router.use(verifyTokenAndTenant);
router.use(checkRole(STAFF_ROLES));

router.get("/",                            getMyWorkers);
router.post("/",                           createWorkerHandler);
router.get("/:id",                         ensureAssignedWorkerCaseworker(), getWorkerHandler);
router.post("/:id/advance",                ensureAssignedWorkerCaseworker(), advanceStageHandler);
router.post("/:id/grant-visa",             ensureAssignedWorkerCaseworker(), grantVisaHandler);
router.post("/:id/reject-visa",            ensureAssignedWorkerCaseworker(), rejectVisaHandler);
router.post("/:id/assign-caseworkers",     ensureAssignedWorkerCaseworker(), assignCaseworkersHandler);
router.get("/:id/audit",                   ensureAssignedWorkerCaseworker(), getAuditTrailHandler);

export default router;
