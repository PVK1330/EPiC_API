import { Router } from 'express';
import {
    getDashboard,
    getBusinessCases,
    getComplianceSummary,
    getBusinessDocuments,
    getBusinessPayments,
    getReportingObligations,
    createReportingObligation,
    updateReportingObligation
} from '../../controllers/SponsorControllers/sponsorDashboard.controller.js';

const router = Router();

router.get('/', getDashboard);
router.get('/cases', getBusinessCases);
router.get('/compliance/summary', getComplianceSummary);
router.get('/documents', getBusinessDocuments);
router.get('/payments', getBusinessPayments);
router.get('/reporting-obligations', getReportingObligations);
router.post('/reporting-obligations', createReportingObligation);
router.patch('/reporting-obligations/:id', updateReportingObligation);

export default router;
