import express from 'express';
import { 
  addSponsoredWorker, 
  getSponsoredWorkers, 
  getSponsoredWorkerDetails,
  updateSponsoredWorker,
  deleteSponsoredWorker,
  updateWorkerStatus
} from '../../controllers/SponsorControllers/sponsorWorker.controller.js';

const router = express.Router();

router.post('/', addSponsoredWorker);
router.get('/', getSponsoredWorkers);
router.get('/:id', getSponsoredWorkerDetails);
router.put('/:id', updateSponsoredWorker);
router.delete('/:id', deleteSponsoredWorker);
router.patch('/:id/status', updateWorkerStatus);

export default router;
