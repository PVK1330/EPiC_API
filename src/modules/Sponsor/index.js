import { Router } from 'express';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import sponsorAccountRoutes from './Account/sponsorAccount.routes.js';
import sponsorWorkerRoutes from './Workers/sponsorWorker.routes.js';
import sponsorLicenceRoutes from './Licence/sponsorLicence.routes.js';
import sponsorLicenceV2Routes from './Licence/sponsorLicenceV2.routes.js';
import sponsorCosRoutes from './Licence/sponsorCos.routes.js';
import sponsorVisaWorkerRoutes from './Licence/sponsorWorker.routes.js';
import sponsorDashboardRoutes from './Dashboard/sponsorDashboard.routes.js';
import workerEventRoutes from './Workers/workerEvent.routes.js';
import complianceDocumentRoutes from './Compliance/complianceDocument.routes.js';
import sponsorComplianceRespondRoutes from './Compliance/sponsorComplianceRespond.routes.js';
import sponsorChangeRequestRoutes from './ChangeRequests/sponsorChangeRequest.routes.js';
import rightToWorkRoutes from './RightToWork/rightToWork.routes.js';
import auditModeRoutes from './Compliance/auditMode.routes.js';
// Section N — Monthly Compliance Review
import monthlyReviewRoutes from './Compliance/monthlyReview.routes.js';
// Section K — Multi-Company Handling
import linkedEntitiesRoutes from './LinkedEntities/sponsorLinkedEntities.routes.js';
// Section O — Sponsor Audit Log
import sponsorAuditLogRoutes from './AuditLog/sponsorAuditLog.routes.js';
import {
  getBusinessCases,
  getBusinessPayments,
  getComplianceSummary,
  getBusinessDocuments,
} from './Dashboard/sponsorDashboard.controller.js';
import {
  createSponsorCheckoutSession,
  verifySponsorCheckoutSession,
  downloadSponsorInvoice,
} from './Payments/sponsorPayment.controller.js';

const router = Router();

// All sponsor routes require authentication and business role
router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.BUSINESS]));

router.use('/account', sponsorAccountRoutes);
router.use('/workers', sponsorWorkerRoutes);
// V2 must mount before '/licence' so its paths aren't shadowed by the V1 router.
router.use('/licence/v2', sponsorLicenceV2Routes);
router.use('/licence', sponsorLicenceRoutes);
router.use('/cos', sponsorCosRoutes);
// Phase 5 — Visa workflow for sponsored workers (SponsoredWorker table, not legacy Cases).
router.use('/visa-workers', sponsorVisaWorkerRoutes);
router.use('/dashboard', sponsorDashboardRoutes);

router.get('/cases', getBusinessCases);
router.get('/payments', getBusinessPayments);
// Sponsor online payments on the tenant Stripe account (licence fee / ISC / case fees).
router.post('/payments/checkout', createSponsorCheckoutSession);
router.get('/payments/verify-session/:session_id', verifySponsorCheckoutSession);
router.get('/payments/:id/invoice', downloadSponsorInvoice);
router.get('/compliance/summary', getComplianceSummary);
router.get('/documents', getBusinessDocuments);

router.use('/worker-events', workerEventRoutes);
router.use('/compliance-documents', complianceDocumentRoutes);
router.use('/compliance-review', sponsorComplianceRespondRoutes);
router.use('/change-requests', sponsorChangeRequestRoutes);
router.use('/right-to-work', rightToWorkRoutes);
router.use('/audit', auditModeRoutes);
// Section N — Monthly Compliance Review
router.use('/compliance/monthly-reviews', monthlyReviewRoutes);
// Section K — Multi-Company Handling
router.use('/linked-entities', linkedEntitiesRoutes);
// Section O — Sponsor Audit Log
router.use('/audit-logs', sponsorAuditLogRoutes);

export default router;
