import { Router } from "express";
import {
  createRtwRecord,
  getRtwRecordsByWorker,
  updateRtwRecord,
} from "./rightToWork.controller.js";
import { upload } from "../../../middlewares/upload.middleware.js";

const router = Router();

router.get("/worker/:workerId", getRtwRecordsByWorker);
router.post("/", upload.single("document"), createRtwRecord);
router.put("/:id", upload.single("document"), updateRtwRecord);

export default router;
