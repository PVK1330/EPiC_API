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

const router = Router();

router.get("/",                            getMyWorkers);
router.post("/",                           createWorkerHandler);
router.get("/:id",                         ensureAssignedWorkerCaseworker(), getWorkerHandler);
router.post("/:id/advance",                ensureAssignedWorkerCaseworker(), advanceStageHandler);
router.post("/:id/grant-visa",             ensureAssignedWorkerCaseworker(), grantVisaHandler);
router.post("/:id/reject-visa",            ensureAssignedWorkerCaseworker(), rejectVisaHandler);
router.post("/:id/assign-caseworkers",     ensureAssignedWorkerCaseworker(), assignCaseworkersHandler);
router.get("/:id/audit",                   ensureAssignedWorkerCaseworker(), getAuditTrailHandler);

export default router;
