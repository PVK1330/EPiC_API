import { Router } from "express";
import {
  createChangeRequest,
  getChangeRequestsBySponsor,
  updateChangeRequestStatus,
} from "./sponsorChangeRequest.controller.js";
import { upload } from "../../../middlewares/upload.middleware.js";

const router = Router();

router.get("/", getChangeRequestsBySponsor);
router.post("/", upload.single("evidenceFile"), createChangeRequest);
router.put("/:id", upload.single("evidenceFile"), updateChangeRequestStatus);

export default router;
