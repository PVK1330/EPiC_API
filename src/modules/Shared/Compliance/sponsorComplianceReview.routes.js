import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  listComplianceReview,
  getComplianceReview,
  startComplianceReview,
  approveComplianceReview,
  rejectComplianceReview,
  requestComplianceInfo,
} from "./sponsorComplianceReview.controller.js";
import {
  reviewStartSchema,
  reviewApproveSchema,
  reviewRejectSchema,
  reviewRequestInfoSchema,
} from "../../../validations/complianceReview.validation.js";

const router = Router();

// Sponsor-compliance review surface — Admin and Caseworker only. Covers
// right-to-work, worker-events and change-requests via :entityType.
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER]));

router.get("/:entityType", listComplianceReview);
router.get("/:entityType/:id", getComplianceReview);

router.patch("/:entityType/:id/review", validate(reviewStartSchema, "complianceReviewStart"), startComplianceReview);
router.patch("/:entityType/:id/approve", validate(reviewApproveSchema, "complianceReviewApprove"), approveComplianceReview);
router.patch("/:entityType/:id/reject", validate(reviewRejectSchema, "complianceReviewReject"), rejectComplianceReview);
router.patch("/:entityType/:id/request-info", validate(reviewRequestInfoSchema, "complianceReviewRequestInfo"), requestComplianceInfo);

export default router;
