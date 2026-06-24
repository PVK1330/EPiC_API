import { Router } from 'express';
import {
  createWorkerEvent,
  deleteWorkerEvent,
  listWorkerEvents,
  updateWorkerEvent,
} from './workerEvent.controller.js';
import { upload } from '../../../middlewares/upload.middleware.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { checkRole, ROLES } from '../../../middlewares/role.middleware.js';

const router = Router();

// S-01 fix: all worker-event routes require an authenticated sponsor session.
router.use(verifyTokenAndTenant, checkRole([ROLES.SPONSOR]));

router.get("/", listWorkerEvents);
router.post("/", upload.single('evidenceFile'), createWorkerEvent);
router.put("/:id", upload.single('evidenceFile'), updateWorkerEvent);
router.delete("/:id", deleteWorkerEvent);

export default router;
