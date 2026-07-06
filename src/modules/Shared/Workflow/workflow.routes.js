import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { requireCandidate } from "../../../middlewares/requireCandidate.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import { handleDocumentUpload } from "../../../middlewares/upload.middleware.js";
import { ensureAssignedCaseCaseworker } from "../../../middlewares/ensureAssignedCaseCaseworker.middleware.js";

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
// backend-authz-12: `assignedCase` restricts caseworkers to cases they are
// assigned to (admins/superadmins bypass inside the guard). Every /cases/:caseId
// staff route carries it so an unassigned caseworker cannot issue CCLs, record
// visa decisions, upload decision docs, mark cases completed, or read the bundle.
const staff = checkRole([ROLES.ADMIN, ROLES.CASEWORKER]);
const assignedCase = ensureAssignedCaseCaseworker();
router.get("/cases/:caseId/bundle", staff, assignedCase, workflowController.getCaseWorkflowBundle);
router.get("/cases/:caseId/data-capture", staff, assignedCase, workflowController.getStaffDataCapture);
router.post("/cases/:caseId/data-capture/send", staff, assignedCase, workflowController.sendDataCaptureRequest);
router.post("/cases/:caseId/request-information", staff, assignedCase, workflowController.sendFurtherInformationRequest);
router.post("/cases/:caseId/send-draft-review", staff, assignedCase, workflowController.sendDraftApplicationForReview);
router.patch("/cases/:caseId/data-capture/review", staff, assignedCase, workflowController.reviewDataCaptureSubmission);
router.get("/cases/:caseId/ccl", staff, assignedCase, workflowController.getCclStatus);
router.post("/cases/:caseId/ccl/propose", staff, assignedCase, workflowController.proposeCclFees);
router.post("/cases/:caseId/ccl/issue", staff, assignedCase, workflowController.issueCcl);
router.post("/cases/:caseId/ccl/send-payment-request", staff, assignedCase, workflowController.sendCclPaymentRequestAction);
router.patch("/cases/:caseId/ccl/fee-review", adminOnly, workflowController.reviewCclFees);
router.get("/ccl/pending-approvals", adminOnly, workflowController.listCclFeePendingApprovals);
router.post("/cases/:caseId/visa-portal-submit", staff, assignedCase, workflowController.staffRecordVisaPortalSubmission);
router.post("/cases/:caseId/biometric-slot", staff, assignedCase, workflowController.staffSendBiometricSlot);
router.post("/cases/:caseId/biometric-docs-uploaded", staff, assignedCase, workflowController.staffRecordBiometricDocsUploaded);
router.post("/cases/:caseId/visa-portal-reply", staff, assignedCase, workflowController.staffRecordVisaPortalReply);
router.post("/cases/:caseId/communicate-decision", staff, assignedCase, workflowController.staffCommunicateDecision);
router.post("/cases/:caseId/upload-decision-document", staff, assignedCase, handleDocumentUpload, workflowController.staffUploadDecisionDocument);
router.post("/cases/:caseId/mark-completed", staff, assignedCase, workflowController.staffMarkCaseCompleted);
router.post("/cases/:caseId/closure-letter", staff, assignedCase, workflowController.staffGenerateClosureLetter);
router.post("/cases/:caseId/resend-final-documents", staff, assignedCase, workflowController.staffResendFinalDocuments);

export default router;
