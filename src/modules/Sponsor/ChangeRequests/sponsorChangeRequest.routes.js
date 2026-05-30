import { Router } from "express";
import {
  createChangeRequest,
  getChangeRequestsBySponsor,
  updateChangeRequestStatus,
} from "./sponsorChangeRequest.controller.js";
import { upload } from "../../../middlewares/upload.middleware.js";

import { validate } from "../../../middlewares/validate.middleware.js";
import * as schema from "../../../validations/sponsorChangeRequest.validation.js";

const router = Router();

router.get("/", getChangeRequestsBySponsor);
router.post("/", upload.single("evidenceFile"), validate(schema.createSponsorChangeRequestSchema), createChangeRequest);
router.put("/:id", upload.single("evidenceFile"), validate(schema.updateSponsorChangeRequestSchema), updateChangeRequestStatus);

export default router;
