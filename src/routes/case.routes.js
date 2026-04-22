import { Router } from "express";
import * as caseController from "../controllers/AdminControllers/case.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../middlewares/role.middleware.js";

const router = Router();

// Require authentication for all routes
router.use(verifyToken);

router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Custom Pipeline & Metrics routes MUST come before /:id routes
router.get("/pipeline", caseController.getPipelineCases);
router.get("/capacity", caseController.getTeamCapacity);
router.patch("/:id/assign", caseController.assignCase);
router.patch("/:id/stage", caseController.updatePipelineStage);

// CRUD Operations
router.post("/", caseController.createCase);
router.get("/filtered", caseController.getCasesWithFilters);
router.get("/", caseController.getAllCases);
router.get("/:id", caseController.getCaseById);
router.put("/:id", caseController.updateCase);
router.delete("/:id", caseController.deleteCase);

export default router;
