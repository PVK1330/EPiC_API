import { Router } from "express";
import * as caseworkerCaseController from "../../controllers/CaseworkerControllers/caseworkerCase.controller.js";
import { verifyToken } from "../../middlewares/auth.middleware.js";
import { checkRole, ROLES } from "../../middlewares/role.middleware.js";

const router = Router();

// Require authentication for all routes
router.use(verifyToken);

// Require caseworker role for all routes
router.use(checkRole([ROLES.CASEWORKER]));

// Get cases assigned to logged-in caseworker with filters
router.get("/", caseworkerCaseController.getMyCases);

// Get dashboard statistics for logged-in caseworker
router.get("/dashboard/stats", caseworkerCaseController.getMyDashboardStats);

// Get pipeline cases for logged-in caseworker
router.get("/pipeline", caseworkerCaseController.getMyPipelineCases);

// Create new case (caseworker can create cases)
router.post("/", caseworkerCaseController.createMyCase);

// Update case (caseworker can update their assigned cases)
router.put("/:id", caseworkerCaseController.updateMyCase);

// Delete case (caseworker can delete their assigned cases)
router.delete("/:id", caseworkerCaseController.deleteMyCase);

// Update case status (caseworker can update their assigned cases)
router.patch("/:id/status", caseworkerCaseController.updateMyCaseStatus);

// Get comprehensive case details for single case page
router.get("/:id/details", caseworkerCaseController.getCaseDetails);

export default router;
