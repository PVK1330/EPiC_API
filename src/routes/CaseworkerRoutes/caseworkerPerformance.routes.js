import { Router } from "express";
import {
  getCaseworkerPerformance,
  getCaseworkerActivityLog,
} from "../../controllers/CaseworkerControllers/caseworkerPerformance.controller.js";
import { verifyToken } from "../../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../../middlewares/role.middleware.js";

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.CASEWORKER, ROLES.ADMIN]));

router.get("/performance", getCaseworkerPerformance);
router.get("/activity-log", getCaseworkerActivityLog);

export default router;
