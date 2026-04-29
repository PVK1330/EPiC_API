import express from 'express';
import { 
  addSponsoredWorker, 
  getSponsoredWorkers, 
  getEmployeeRecords,
  getSponsoredWorkerDetails,
  updateSponsoredWorker,
  deleteSponsoredWorker,
  updateWorkerStatus
} from '../../controllers/SponsorControllers/sponsorWorker.controller.js';

const router = express.Router();

router.post('/', addSponsoredWorker);
router.get('/', getSponsoredWorkers);
router.get('/employee-records', getEmployeeRecords);
router.get('/:id', getSponsoredWorkerDetails);
router.put('/:id', updateSponsoredWorker);
router.delete('/:id', deleteSponsoredWorker);
router.patch('/:id/status', updateWorkerStatus);

export default router;
