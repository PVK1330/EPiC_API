import { Router } from 'express';
import {
  getCaseworkerPerformance,
  getCaseworkerActivityLog,
  exportCaseworkerPerformance,
} from './caseworkerPerformance.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES, requirePlanModule } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));
router.use(requirePlanModule('caseworker.performance'));

router.get("/performance", getCaseworkerPerformance);
router.get("/activity-log", getCaseworkerActivityLog);
router.get("/performance/export", exportCaseworkerPerformance);

export default router;
