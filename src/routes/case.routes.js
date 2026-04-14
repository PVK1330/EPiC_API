import { Router } from "express";
import * as caseController from "../controllers/AdminControllers/case.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

// Require authentication for all routes
router.use(verifyToken);

// Apply role-based access control if needed (Admins, Caseworkers, etc. can manage cases)
// Adjust as per business logic, allowing Admin and Caseworker. Let's allow ADMIN initially, or both.
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// CRUD Operations
router.post("/", caseController.createCase);
router.get("/", caseController.getAllCases);
router.get("/:id", caseController.getCaseById);
router.put("/:id", caseController.updateCase);
router.delete("/:id", caseController.deleteCase);

export default router;
