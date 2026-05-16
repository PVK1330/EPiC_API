import { Router } from 'express';
import * as taskController from '../../Admin/Tasks/task.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

router.post("/", taskController.createTask);
router.get("/", taskController.getTasks);
router.get("/case/:id", taskController.getTaskByCaseId);
router.get("/assign", taskController.getTasksByUserId);
router.get("/:id", taskController.getTaskById);
router.put("/:id", taskController.updateTask);
router.delete("/:id", taskController.deleteTask);

export default router;
