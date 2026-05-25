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

const router = express.Router();

router.post('/', addSponsoredWorker);
router.get('/', getSponsoredWorkers);
router.get('/employee-records', getEmployeeRecords);
router.get('/absence/worker/:workerId', getAbsenceByWorker);
router.post('/absence', upload.single('document'), createAbsenceRecord);
router.put('/absence/:id', upload.single('document'), updateAbsenceRecord);
router.get('/sms-logs', getSmsLogsBySponsor);
router.post('/sms-logs', upload.single('screenshot'), createSmsLog);
router.get('/:id', getSponsoredWorkerDetails);
router.put('/:id', updateSponsoredWorker);
router.delete('/:id', deleteSponsoredWorker);
router.patch('/:id/status', updateWorkerStatus);

export default router;

