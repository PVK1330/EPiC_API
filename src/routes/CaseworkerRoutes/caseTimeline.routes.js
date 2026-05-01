import { Router } from "express";
import {
  getCaseTimeline,
  addTimelineEntry,
  getCaseTimelineStats,
} from "../../controllers/CaseworkerControllers/caseTimeline.controller.js";
import { verifyToken } from "../../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../../middlewares/role.middleware.js";

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

router.get("/case/:caseId/timeline", getCaseTimeline);
router.post("/case/:caseId/timeline", addTimelineEntry);
router.get("/case/:caseId/timeline/stats", getCaseTimelineStats);

export default router;
