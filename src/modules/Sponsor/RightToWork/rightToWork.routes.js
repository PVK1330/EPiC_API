import { Router } from "express";
import {
  getAllRtwRecordsForSponsor,
  createRtwRecord,
  getRtwRecordsByWorker,
  updateRtwRecord,
  downloadRtwDocument,
} from "./rightToWork.controller.js";
import { upload } from "../../../middlewares/upload.middleware.js";

const router = Router();

// Flat list for compliance review status page — all RTW records owned by this sponsor.
router.get("/", getAllRtwRecordsForSponsor);
router.get("/worker/:workerId", getRtwRecordsByWorker);
// Authenticated evidence-document view (uploads are not served statically).
router.get("/:id/document", downloadRtwDocument);
router.post("/", upload.single("document"), createRtwRecord);
router.put("/:id", upload.single("document"), updateRtwRecord);

export default router;
