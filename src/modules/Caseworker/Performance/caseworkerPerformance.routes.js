import { Router } from 'express';
import {
  getCaseworkerPerformance,
  getCaseworkerActivityLog,
} from './caseworkerPerformance.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

router.get("/performance", getCaseworkerPerformance);
router.get("/activity-log", getCaseworkerActivityLog);

export default router;
