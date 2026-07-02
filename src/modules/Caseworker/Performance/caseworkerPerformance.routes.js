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

// requirePlanModule is applied PER-ROUTE, not as a blanket router.use(): this
// router shares the /caseworker mount with caseworkerRoutes (and is mounted
// first), so a blanket module guard here intercepted unrelated sibling paths
// (e.g. /caseworker/departments/dropdown) and 403'd admins whose plan excludes
// caseworker.performance, before the request could fall through to the real
// route. Gating each performance route individually keeps the plan scope intact
// while letting non-performance paths fall through.
const gate = requirePlanModule('caseworker.performance');
router.get("/performance", gate, getCaseworkerPerformance);
router.get("/activity-log", gate, getCaseworkerActivityLog);
router.get("/performance/export", gate, exportCaseworkerPerformance);

export default router;
