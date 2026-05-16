import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import * as microsoftController from './microsoft.controller.js';

const router = Router();

router.use(verifyTokenAndTenant);

router.get('/auth-url', microsoftController.getMicrosoftAuthUrl);
router.get('/status', microsoftController.getMicrosoftStatus);
router.post('/refresh-token', microsoftController.refreshMicrosoftToken);
router.post('/disconnect', microsoftController.disconnectMicrosoft);

export default router;
