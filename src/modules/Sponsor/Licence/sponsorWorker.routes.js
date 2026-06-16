import { Router } from "express";
import {
  listMyWorkers,
  getMyWorker,
  registerWorker,
  getMyWorkerAudit,
} from "./sponsorWorker.controller.js";
import { requireActiveSponsorLicence } from "../../../middlewares/requireActiveSponsorLicence.middleware.js";

const router = Router();

// All worker operations require an active sponsor licence.
router.use(requireActiveSponsorLicence());

router.get("/",              listMyWorkers);
router.post("/",             registerWorker);
router.get("/:id",           getMyWorker);
router.get("/:id/audit",     getMyWorkerAudit);

export default router;
