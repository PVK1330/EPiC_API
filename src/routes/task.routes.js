import { Router } from "express";
import * as taskController from "../controllers/AdminControllers/task.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

router.use(verifyToken);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

router.post("/", taskController.createTask);
router.get("/", taskController.getTasks);
router.get("/:id", taskController.getTaskById);
router.get("/case/:id", taskController.getTaskByCaseId);
router.put("/:id", taskController.updateTask);
router.delete("/:id", taskController.deleteTask);

export default router;
