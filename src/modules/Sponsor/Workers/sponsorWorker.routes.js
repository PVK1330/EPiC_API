import express from 'express';
import {
  addSponsoredWorker,
  getSponsoredWorkers,
  getEmployeeRecords,
  downloadWorkerDocuments,
  getSponsoredWorkerDetails,
  updateSponsoredWorker,
  deleteSponsoredWorker,
  updateWorkerStatus,
  createAbsenceRecord,
  getAbsenceByWorker,
  updateAbsenceRecord,
  deleteAbsenceRecord,
  listAllAbsences,
  createSmsLog,
  getSmsLogsBySponsor,
} from './sponsorWorker.controller.js';
import { secureUpload } from '../../../middlewares/upload.middleware.js';
import { requireActiveSponsorLicence } from '../../../middlewares/requireActiveSponsorLicence.middleware.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';
import { numericParam } from '../../../middlewares/validateParam.middleware.js';

const router = express.Router();

// S-02 fix: every route on this router requires an authenticated sponsor session.
router.use(verifyTokenAndTenant, checkRole([ROLES.SPONSOR]));

// SPN-20: reject non-numeric id-style params with 400 before any DB query.
router.param('id', numericParam('id'));
router.param('candidateId', numericParam('candidate id'));
router.param('workerId', numericParam('worker id'));

// --- Worker sponsorship actions: require an ACTIVE sponsor licence ---
// Creation + mutations on sponsored workers are gated.
router.post('/', requireActiveSponsorLicence(), addSponsoredWorker);
router.put('/:id', requireActiveSponsorLicence(), updateSponsoredWorker);
router.patch('/:id/status', requireActiveSponsorLicence(), updateWorkerStatus);

// --- Allowed regardless of licence status (reads + compliance reporting) ---
router.get('/', getSponsoredWorkers);
router.get('/employee-records', getEmployeeRecords);
router.get('/:candidateId/documents/download', downloadWorkerDocuments);
router.get('/absence', listAllAbsences);
router.get('/absence/worker/:workerId', getAbsenceByWorker);
router.post('/absence', ...secureUpload('document'), createAbsenceRecord);
router.put('/absence/:id', ...secureUpload('document'), updateAbsenceRecord);
router.delete('/absence/:id', deleteAbsenceRecord);
router.get('/sms-logs', getSmsLogsBySponsor);
router.post('/sms-logs', ...secureUpload('screenshot'), createSmsLog);
router.get('/:id', getSponsoredWorkerDetails);
router.delete('/:id', deleteSponsoredWorker);

export default router;

