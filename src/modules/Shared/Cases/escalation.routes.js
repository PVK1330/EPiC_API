import { Router } from 'express';
import * as escalationController from '../../Admin/Dashboard/escalation.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN]));

router.post("/", escalationController.createEscalation);

router.get("/", escalationController.getAllEscalations);

router.get("/export/excel", escalationController.exportEscalationsExcel);

router.get("/kpi", escalationController.getEscalationKPI);

router.get("/:id", escalationController.getEscalationById);

router.put("/:id", escalationController.updateEscalation);

router.patch("/:id/assign", escalationController.assignEscalation);

router.delete("/:id", escalationController.deleteEscalation);

export default router;
