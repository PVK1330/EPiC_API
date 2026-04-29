import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import * as microsoftController from '../controllers/microsoft.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/auth-url', microsoftController.getMicrosoftAuthUrl);
router.get('/status', microsoftController.getMicrosoftStatus);
router.post('/refresh-token', microsoftController.refreshMicrosoftToken);
router.post('/disconnect', microsoftController.disconnectMicrosoft);

export default router;
