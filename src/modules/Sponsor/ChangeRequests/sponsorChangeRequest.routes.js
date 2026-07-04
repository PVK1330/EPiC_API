import { Router } from "express";
import {
  createChangeRequest,
  getChangeRequestsBySponsor,
  updateChangeRequestStatus,
} from "./sponsorChangeRequest.controller.js";
import { secureUpload } from "../../../middlewares/upload.middleware.js";

import { validate } from "../../../middlewares/validate.middleware.js";
import * as schema from "../../../validations/sponsorChangeRequest.validation.js";

const router = Router();

router.get("/", getChangeRequestsBySponsor);
router.post("/", ...secureUpload("evidenceFile"), validate(schema.createSponsorChangeRequestSchema), createChangeRequest);
router.put("/:id", ...secureUpload("evidenceFile"), validate(schema.updateSponsorChangeRequestSchema), updateChangeRequestStatus);

export default router;
