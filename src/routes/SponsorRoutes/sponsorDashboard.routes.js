import { Router } from 'express';
import {
    getDashboard,
    getBusinessCases,
    getComplianceSummary,
    getBusinessDocuments,
    getBusinessPayments
} from '../../controllers/SponsorControllers/sponsorDashboard.controller.js';

const router = Router();

router.get('/', getDashboard);
router.get('/cases', getBusinessCases);
router.get('/compliance/summary', getComplianceSummary);
router.get('/documents', getBusinessDocuments);
router.get('/payments', getBusinessPayments);

export default router;
