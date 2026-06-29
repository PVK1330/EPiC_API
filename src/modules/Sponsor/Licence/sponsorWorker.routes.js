import { Router } from "express";
import {
  listMyWorkers,
  getMyWorker,
  registerWorker,
  deleteMyWorker,
  getMyWorkerAudit,
  assignWorkerCos,
} from "./sponsorWorker.controller.js";
import { requireActiveSponsorLicence } from "../../../middlewares/requireActiveSponsorLicence.middleware.js";

const router = Router();

// Reads are always allowed — sponsors can view their workers regardless of licence status.
router.get("/",           listMyWorkers);
router.get("/:id",        getMyWorker);
router.get("/:id/audit",  getMyWorkerAudit);

// Mutations require an active sponsor licence.
router.post("/",               requireActiveSponsorLicence(), registerWorker);
router.post("/:id/assign-cos", requireActiveSponsorLicence(), assignWorkerCos);
router.delete("/:id",          requireActiveSponsorLicence(), deleteMyWorker);

export default router;
