import { Router } from 'express';
import {
  getCaseTimeline,
  addTimelineEntry,
  getCaseTimelineStats,
} from './caseTimeline.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

router.get("/case/:caseId/timeline", getCaseTimeline);
router.post("/case/:caseId/timeline", addTimelineEntry);
router.get("/case/:caseId/timeline/stats", getCaseTimelineStats);

export default router;
