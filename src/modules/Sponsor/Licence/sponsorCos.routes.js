import { Router } from 'express';
import { getCosSummary, requestCosAllocation } from './sponsorCos.controller.js';

const router = Router();

router.get('/summary', getCosSummary);
router.post('/request', requestCosAllocation);

export default router;
