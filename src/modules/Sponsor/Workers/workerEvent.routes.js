import { Router } from 'express';
import {
  createWorkerEvent,
  deleteWorkerEvent,
  listWorkerEvents,
  updateWorkerEvent,
} from './workerEvent.controller.js';
import { upload } from '../../../middlewares/upload.middleware.js';

const router = Router();

router.get("/", listWorkerEvents);
router.post("/", upload.single('evidenceFile'), createWorkerEvent);
router.put("/:id", upload.single('evidenceFile'), updateWorkerEvent);
router.delete("/:id", deleteWorkerEvent);

export default router;
