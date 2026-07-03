import { Router } from 'express';
import { getOnboardingStatus, completeStep, listSteps } from './onboarding.controller.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';

const router = Router();

// CW-05: the onboarding wizard is a post-login flow for org users (status /
// complete-step both require an organisation context). Require authentication on
// the whole router so the step list is no longer served to anonymous callers.
router.use(verifyTokenAndTenant);

router.get('/steps', listSteps);
router.get('/status', getOnboardingStatus);
router.post('/complete-step', completeStep);

export default router;
