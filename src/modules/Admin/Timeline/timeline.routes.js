import { Router } from 'express';
import * as timelineController from './timeline.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);

router.get('/global', checkRole([ROLES.ADMIN, ROLES.SUPERADMIN]), timelineController.getGlobalTimeline);
router.get('/case/:id', timelineController.getCaseTimeline);
router.get('/candidate/:id', checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.SUPERADMIN]), timelineController.getCandidateTimeline);
router.get('/sponsor/:id', checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.SUPERADMIN]), timelineController.getSponsorTimeline);

export default router;
