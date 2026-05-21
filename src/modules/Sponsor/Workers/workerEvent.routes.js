import { Router } from 'express';
import {
  createWorkerEvent,
  deleteWorkerEvent,
  listWorkerEvents,
  updateWorkerEvent,
} from './workerEvent.controller.js';

const router = Router();

router.get("/", listWorkerEvents);
router.post("/", createWorkerEvent);
router.put("/:id", updateWorkerEvent);
router.delete("/:id", deleteWorkerEvent);

export default router;
