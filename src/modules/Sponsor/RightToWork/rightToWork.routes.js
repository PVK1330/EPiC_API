import { Router } from "express";
import {
  getAllRtwRecordsForSponsor,
  createRtwRecord,
  getRtwRecordsByWorker,
  updateRtwRecord,
} from "./rightToWork.controller.js";
import { secureUpload } from "../../../middlewares/upload.middleware.js";

const router = Router();

// Flat list for compliance review status page — all RTW records owned by this sponsor.
router.get("/", getAllRtwRecordsForSponsor);
router.get("/worker/:workerId", getRtwRecordsByWorker);
router.post("/", ...secureUpload("document"), createRtwRecord);
router.put("/:id", ...secureUpload("document"), updateRtwRecord);

export default router;
