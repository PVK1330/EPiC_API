import { Router } from 'express';
import * as controller from './candidate.controller.js';
import { validateCandidate } from './candidate.validator.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';

const router = Router();

router.use(verifyTokenAndTenant);

router.post("/", validateCandidate, controller.createCandidate);
router.get("/", controller.getAllCandidates);
router.get("/:id", controller.getCandidateById);
router.patch("/:id", validateCandidate, controller.updateCandidate);
router.delete("/:id", controller.deleteCandidate);
router.post("/:id/reset-password", controller.resetCandidatePassword);
router.get("/:id/application", controller.getCandidateApplication);
router.put("/:id/application", controller.updateCandidateApplication);

export default router;
