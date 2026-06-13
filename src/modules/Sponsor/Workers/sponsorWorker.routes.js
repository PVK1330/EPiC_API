import express from 'express';
import {
  addSponsoredWorker,
  getSponsoredWorkers,
  getEmployeeRecords,
  getSponsoredWorkerDetails,
  updateSponsoredWorker,
  deleteSponsoredWorker,
  updateWorkerStatus,
  createAbsenceRecord,
  getAbsenceByWorker,
  updateAbsenceRecord,
  createSmsLog,
  getSmsLogsBySponsor,
} from './sponsorWorker.controller.js';
import { upload } from '../../../middlewares/upload.middleware.js';
import { requireActiveSponsorLicence } from '../../../middlewares/requireActiveSponsorLicence.middleware.js';

const router = express.Router();

// --- Worker sponsorship actions: require an ACTIVE sponsor licence ---
// Creation + mutations on sponsored workers are gated.
router.post('/', requireActiveSponsorLicence(), addSponsoredWorker);
router.put('/:id', requireActiveSponsorLicence(), updateSponsoredWorker);
router.patch('/:id/status', requireActiveSponsorLicence(), updateWorkerStatus);

// --- Allowed regardless of licence status (reads + compliance reporting) ---
router.get('/', getSponsoredWorkers);
router.get('/employee-records', getEmployeeRecords);
router.get('/absence/worker/:workerId', getAbsenceByWorker);
router.post('/absence', upload.single('document'), createAbsenceRecord);
router.put('/absence/:id', upload.single('document'), updateAbsenceRecord);
router.get('/sms-logs', getSmsLogsBySponsor);
router.post('/sms-logs', upload.single('screenshot'), createSmsLog);
router.get('/:id', getSponsoredWorkerDetails);
router.delete('/:id', deleteSponsoredWorker);

export default router;

