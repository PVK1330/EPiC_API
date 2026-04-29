import { Router } from 'express';
import { getCosSummary, requestCosAllocation } from '../../controllers/SponsorControllers/sponsorCos.controller.js';

const router = Router();

router.get('/summary', getCosSummary);
router.post('/request', requestCosAllocation);

export default router;
