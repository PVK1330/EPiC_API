import { Router } from 'express';
import { getCosSummary, requestCosAllocation, getCosRequests, updateCosRequest, deleteCosRequest, exportCosSummary, exportCosRequests } from './sponsorCos.controller.js';

const router = Router();

router.get('/summary', getCosSummary);
router.post('/request', requestCosAllocation);
router.get('/requests', getCosRequests);
router.put('/requests/:id', updateCosRequest);
router.delete('/requests/:id', deleteCosRequest);
router.get('/export/summary', exportCosSummary);
router.get('/export/requests', exportCosRequests);

export default router;
