import { Router } from 'express';
import {
    getAssignedLicenceApplications,
    getMyAssignedDashboard,
    updateLicenceReviewStatus,
    getLicenceApplicationAudit,
    getLicenceApplicationV2Full
} from '../caseworkerLicence.controller.js';
import {
    startLicenceReview,
    startLicenceGovernmentRegistration,
    completeLicenceGovernmentRegistration,
    requestLicenceGovernmentCredentials,
    recordLicenceGovernmentSubmission,
} from '../caseworkerLicenceGovernment.controller.js';
import {
    getCaseworkerIntakeSummary,
    getIntakeReadiness,
    verifyCaseworkerDocument,
    rejectCaseworkerDocument,
    requestCaseworkerDocumentInfo,
    verifyCaseworkerAppendixDocument,
    rejectCaseworkerAppendixDocument,
} from './caseworkerLicenceIntake.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, STAFF_ROLES } from '../../../middlewares/role.middleware.js';
import { ensureAssignedCaseworker } from '../../../middlewares/ensureAssignedCaseworker.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import { getLicenceStages, completeLicenceStageTask, downloadLicenceDocument } from '../../Shared/Licence/licenceStage.controller.js';
import {
    completeRegistrationSchema,
    governmentSubmissionSchema,
} from '../../../validations/licenceGovernment.validation.js';

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole(STAFF_ROLES));

// My Assigned Applications dashboard (assigned list + status counts).
router.get("/assigned", getAssignedLicenceApplications);
router.get("/my-assigned", getMyAssignedDashboard);

// Review actions (Approve / Reject / Request Information) — only the assigned
// caseworker (or an admin override) may proceed; anyone else gets HTTP 403.
router.patch("/update-status/:id", ensureAssignedCaseworker(), updateLicenceReviewStatus);

// Full normalized V2 application (read-only) — same assignment access guard.
router.get("/v2/:id", ensureAssignedCaseworker(), getLicenceApplicationV2Full);

// Assignment history + reviewer actions for an application (same access guard).
router.get("/:id/audit", ensureAssignedCaseworker(), getLicenceApplicationAudit);

// Stages panel — assigned caseworker (or admin override) may view + complete tasks.
router.get("/:id/stages", ensureAssignedCaseworker(), getLicenceStages);
router.post("/:id/stages/:stageKey/complete", ensureAssignedCaseworker(), completeLicenceStageTask);

// Stream an uploaded evidence document (assignment-guarded).
router.get("/:id/documents/:index/download", ensureAssignedCaseworker(), downloadLicenceDocument);

// Intake: information form + document checklist review.
router.get("/:id/intake", ensureAssignedCaseworker(), getCaseworkerIntakeSummary);
router.get("/:id/intake/readiness", ensureAssignedCaseworker(), getIntakeReadiness);
router.patch("/:id/intake/documents/:documentKey/verify", ensureAssignedCaseworker(), verifyCaseworkerDocument);
router.patch("/:id/intake/documents/:documentKey/reject", ensureAssignedCaseworker(), rejectCaseworkerDocument);
router.patch("/:id/intake/documents/:documentKey/request-info", ensureAssignedCaseworker(), requestCaseworkerDocumentInfo);

// Appendix A documents (V2 wizard uploads) — caseworker verify / reject.
router.patch("/:id/appendix-documents/:documentId/verify", ensureAssignedCaseworker(), verifyCaseworkerAppendixDocument);
router.patch("/:id/appendix-documents/:documentId/reject", ensureAssignedCaseworker(), rejectCaseworkerAppendixDocument);

// Government processing pipeline (Phase 3).
router.post("/:id/start-review", ensureAssignedCaseworker(), startLicenceReview);
router.post("/:id/government-registration/start", ensureAssignedCaseworker(), startLicenceGovernmentRegistration);
router.post("/:id/government-registration/complete", ensureAssignedCaseworker(), validate(completeRegistrationSchema), completeLicenceGovernmentRegistration);
router.post("/:id/request-government-credentials", ensureAssignedCaseworker(), requestLicenceGovernmentCredentials);
router.post("/:id/government-submission", ensureAssignedCaseworker(), validate(governmentSubmissionSchema), recordLicenceGovernmentSubmission);

export default router;
