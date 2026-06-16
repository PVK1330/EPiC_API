import express from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ADMIN_ROLES } from "../../../middlewares/role.middleware.js";
import {
  getAllWorkers,
  getWorkerAdmin,
  createWorkerAdmin,
  advanceWorkerAdmin,
  grantVisaAdmin,
  rejectVisaAdmin,
  assignCaseworkersAdmin,
  getWorkerAuditAdmin,
} from "./adminWorker.controller.js";

const router = express.Router();

router.use(verifyTokenAndTenant);
router.use(checkRole(ADMIN_ROLES));

router.get("/",                         getAllWorkers);
router.post("/",                        createWorkerAdmin);
router.get("/:id",                      getWorkerAdmin);
router.post("/:id/advance",             advanceWorkerAdmin);
router.post("/:id/grant-visa",          grantVisaAdmin);
router.post("/:id/reject-visa",         rejectVisaAdmin);
router.post("/:id/assign-caseworkers",  assignCaseworkersAdmin);
router.get("/:id/audit",                getWorkerAuditAdmin);

export default router;
