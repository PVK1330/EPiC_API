import { Router } from 'express';
import * as escalationController from '../../Admin/Dashboard/escalation.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES, requirePlanModule } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(requirePlanModule('admin.escalations'));

// Caseworkers can create escalations from a case detail page
router.post("/", checkRole([ROLES.ADMIN, ROLES.CASEWORKER]), escalationController.createEscalation);

// All remaining routes are admin-only
router.use(checkRole([ROLES.ADMIN]));

router.get("/", escalationController.getAllEscalations);

router.get("/export/excel", escalationController.exportEscalationsExcel);

router.get("/kpi", escalationController.getEscalationKPI);

router.get("/:id", escalationController.getEscalationById);

router.put("/:id", escalationController.updateEscalation);

router.patch("/:id/assign", escalationController.assignEscalation);

router.delete("/:id", escalationController.deleteEscalation);

export default router;
