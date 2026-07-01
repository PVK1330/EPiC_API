import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { requireCandidate } from "../../../middlewares/requireCandidate.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import { handleDocumentUpload } from "../../../middlewares/upload.middleware.js";

const adminOnly = checkRole([ROLES.ADMIN]);
import * as workflowController from "./workflow.controller.js";

const router = Router();

router.use(verifyTokenAndTenant);

// Candidate
router.get("/data-capture", requireCandidate, workflowController.getDataCaptureForm);
router.put("/data-capture", requireCandidate, workflowController.saveDataCaptureSubmission);
router.post("/data-capture/submit", requireCandidate, workflowController.submitDataCapture);
router.get("/decision-documents", requireCandidate, workflowController.getDecisionDocuments);
router.post("/request-final-documents", requireCandidate, workflowController.candidateRequestFinalDocuments);
router.get("/ccl", requireCandidate, workflowController.getCandidateCcl);
router.get("/ccl/download", requireCandidate, workflowController.downloadCandidateCcl);
router.post("/ccl/accept", requireCandidate, workflowController.acceptCcl);
router.post("/ccl/confirm-signed", requireCandidate, workflowController.confirmCclSigned);
router.get("/payments/schedule", requireCandidate, workflowController.getCandidatePaymentSchedule);
router.get("/my-tasks", requireCandidate, workflowController.getCandidateTasks);
router.patch("/my-tasks/:taskId/complete", requireCandidate, workflowController.completeCandidateTask);
router.get("/process", requireCandidate, workflowController.getCandidateWorkflowProcess);
router.post("/draft-review", requireCandidate, workflowController.submitCandidateDraftReview);
router.post("/biometric-availability", requireCandidate, workflowController.submitCandidateBiometricAvailability);
router.post("/mark-biometric-attended", requireCandidate, workflowController.candidateMarkBiometricAttended);

// Caseworker / Admin
const staff = checkRole([ROLES.ADMIN, ROLES.CASEWORKER]);
router.get("/cases/:caseId/bundle", staff, workflowController.getCaseWorkflowBundle);
router.get("/cases/:caseId/data-capture", staff, workflowController.getStaffDataCapture);
router.post("/cases/:caseId/data-capture/send", staff, workflowController.sendDataCaptureRequest);
router.post("/cases/:caseId/request-information", staff, workflowController.sendFurtherInformationRequest);
router.post("/cases/:caseId/send-draft-review", staff, workflowController.sendDraftApplicationForReview);
router.patch("/cases/:caseId/data-capture/review", staff, workflowController.reviewDataCaptureSubmission);
router.get("/cases/:caseId/ccl", staff, workflowController.getCclStatus);
router.post("/cases/:caseId/ccl/propose", staff, workflowController.proposeCclFees);
router.post("/cases/:caseId/ccl/issue", staff, workflowController.issueCcl);
router.post("/cases/:caseId/ccl/send-payment-request", staff, workflowController.sendCclPaymentRequestAction);
router.patch("/cases/:caseId/ccl/fee-review", adminOnly, workflowController.reviewCclFees);
router.get("/ccl/pending-approvals", adminOnly, workflowController.listCclFeePendingApprovals);
router.post("/cases/:caseId/visa-portal-submit", staff, workflowController.staffRecordVisaPortalSubmission);
router.post("/cases/:caseId/biometric-slot", staff, workflowController.staffSendBiometricSlot);
router.post("/cases/:caseId/biometric-docs-uploaded", staff, workflowController.staffRecordBiometricDocsUploaded);
router.post("/cases/:caseId/visa-portal-reply", staff, workflowController.staffRecordVisaPortalReply);
router.post("/cases/:caseId/communicate-decision", staff, workflowController.staffCommunicateDecision);
router.post("/cases/:caseId/upload-decision-document", staff, handleDocumentUpload, workflowController.staffUploadDecisionDocument);
router.post("/cases/:caseId/mark-completed", staff, workflowController.staffMarkCaseCompleted);
router.post("/cases/:caseId/closure-letter", staff, workflowController.staffGenerateClosureLetter);
router.post("/cases/:caseId/resend-final-documents", staff, workflowController.staffResendFinalDocuments);

export default router;
