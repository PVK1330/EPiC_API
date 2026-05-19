import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { requireCandidate } from "../../../middlewares/requireCandidate.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";

const adminOnly = checkRole([ROLES.ADMIN]);
import * as workflowController from "./workflow.controller.js";

const router = Router();

router.use(verifyTokenAndTenant);

// Candidate
router.get("/data-capture", requireCandidate, workflowController.getDataCaptureForm);
router.put("/data-capture", requireCandidate, workflowController.saveDataCaptureSubmission);
router.post("/data-capture/submit", requireCandidate, workflowController.submitDataCapture);
router.get("/decision-documents", requireCandidate, workflowController.getDecisionDocuments);
router.get("/ccl", requireCandidate, workflowController.getCandidateCcl);
router.get("/ccl/download", requireCandidate, workflowController.downloadCandidateCcl);
router.post("/ccl/accept", requireCandidate, workflowController.acceptCcl);
router.post("/ccl/confirm-signed", requireCandidate, workflowController.confirmCclSigned);
router.get("/payments/schedule", requireCandidate, workflowController.getCandidatePaymentSchedule);
router.get("/my-tasks", requireCandidate, workflowController.getCandidateTasks);
router.patch("/my-tasks/:taskId/complete", requireCandidate, workflowController.completeCandidateTask);

// Caseworker / Admin
const staff = checkRole([ROLES.ADMIN, ROLES.CASEWORKER]);
router.get("/cases/:caseId/bundle", staff, workflowController.getCaseWorkflowBundle);
router.get("/cases/:caseId/data-capture", staff, workflowController.getStaffDataCapture);
router.post("/cases/:caseId/data-capture/send", staff, workflowController.sendDataCaptureRequest);
router.patch("/cases/:caseId/data-capture/review", staff, workflowController.reviewDataCaptureSubmission);
router.get("/cases/:caseId/ccl", staff, workflowController.getCclStatus);
router.post("/cases/:caseId/ccl/propose", staff, workflowController.proposeCclFees);
router.post("/cases/:caseId/ccl/issue", staff, workflowController.issueCcl);
router.patch("/cases/:caseId/ccl/fee-review", adminOnly, workflowController.reviewCclFees);
router.get("/ccl/pending-approvals", adminOnly, workflowController.listCclFeePendingApprovals);

export default router;
