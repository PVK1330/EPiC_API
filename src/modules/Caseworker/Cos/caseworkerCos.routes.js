import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import {
  getMyAssignedCosRequests,
  approveAssignedCosRequest,
  rejectAssignedCosRequest,
} from "./caseworkerCos.controller.js";

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

// CoS requests assigned to me (the caseworker).
router.get("/assigned", getMyAssignedCosRequests);

// Review actions — only the assigned caseworker (or admin) may approve/reject.
router.patch("/:id/approve", approveAssignedCosRequest);
router.patch("/:id/reject", rejectAssignedCosRequest);

export default router;
