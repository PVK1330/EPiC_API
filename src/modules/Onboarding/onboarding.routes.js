import { Router } from 'express';
import { getOnboardingStatus, completeStep, listSteps } from './onboarding.controller.js';

const router = Router();

router.get('/steps', listSteps);
router.get('/status', getOnboardingStatus);
router.post('/complete-step', completeStep);

export default router;
