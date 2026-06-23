import { Router } from 'express';
import * as caseDetailController from '../../Admin/Dashboard/caseDetail.controller.js';
import * as timelineController from '../timeline.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// Require authentication for all routes
router.use(verifyTokenAndTenant);

// Apply role-based access control
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

// Case Detail Routes
router.get("/:id", caseDetailController.getCaseDetails);
router.patch("/:id/status", caseDetailController.updateCaseStatus);
router.patch("/:id/finance", caseDetailController.updateCaseFinance);
router.post("/:id/payments/manual", caseDetailController.recordManualCasePayment);

// Timeline Routes
router.get("/:id/timeline", timelineController.getCaseTimeline);
router.post("/timeline", timelineController.createTimelineEntry);
router.put("/timeline/:id", timelineController.updateTimelineEntry);
router.delete("/timeline/:id", timelineController.deleteTimelineEntry);

// Export Routes
router.get("/:id/export/csv", caseDetailController.exportCaseCSV);
router.get("/:id/export/pdf", caseDetailController.exportCasePDF);
router.get("/:id/invoice/pdf", caseDetailController.exportCaseInvoicePDF);

export default router;
