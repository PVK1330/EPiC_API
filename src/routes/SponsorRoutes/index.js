import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { checkRole, ROLES } from '../../middlewares/role.middleware.js';
import sponsorAccountRoutes from './sponsorAccount.routes.js';
import sponsorWorkerRoutes from './sponsorWorker.routes.js';
import sponsorLicenceRoutes from './sponsorLicence.routes.js';
import sponsorCosRoutes from './sponsorCos.routes.js';
import sponsorDashboardRoutes from './sponsorDashboard.routes.js';
import workerEventRoutes from './workerEvent.routes.js';
import complianceDocumentRoutes from './complianceDocument.routes.js';
import {
  getBusinessCases,
  getBusinessPayments,
  getComplianceSummary,
  getBusinessDocuments,
  getReportingObligations,
  createReportingObligation,
  updateReportingObligation,
} from '../../controllers/SponsorControllers/sponsorDashboard.controller.js';

const router = Router();

// All sponsor routes require authentication and business role
router.use(verifyToken);
router.use(checkRole([ROLES.BUSINESS]));

router.use('/account', sponsorAccountRoutes);
router.use('/workers', sponsorWorkerRoutes);
router.use('/licence', sponsorLicenceRoutes);
router.use('/cos', sponsorCosRoutes);
router.use('/dashboard', sponsorDashboardRoutes);

router.get('/cases', getBusinessCases);
router.get('/payments', getBusinessPayments);
router.get('/compliance/summary', getComplianceSummary);
router.get('/documents', getBusinessDocuments);
router.get('/reporting-obligations', getReportingObligations);
router.post('/reporting-obligations', createReportingObligation);
router.patch('/reporting-obligations/:id', updateReportingObligation);

router.use('/worker-events', workerEventRoutes);
router.use('/compliance-documents', complianceDocumentRoutes);

export default router;
