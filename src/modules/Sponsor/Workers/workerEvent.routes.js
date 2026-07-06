import { Router } from 'express';
import {
  createWorkerEvent,
  deleteWorkerEvent,
  listWorkerEvents,
  updateWorkerEvent,
  downloadWorkerEventEvidence,
} from './workerEvent.controller.js';
import { secureUpload } from '../../../middlewares/upload.middleware.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// S-01 fix: all worker-event routes require an authenticated sponsor session.
router.use(verifyTokenAndTenant, checkRole([ROLES.SPONSOR]));

router.get("/", listWorkerEvents);
router.get("/:id/evidence", downloadWorkerEventEvidence);
router.post("/", ...secureUpload('evidenceFile'), createWorkerEvent);
router.put("/:id", ...secureUpload('evidenceFile'), updateWorkerEvent);
router.delete("/:id", deleteWorkerEvent);

export default router;
