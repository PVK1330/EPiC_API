import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import { handleSponsorRegistrationUpload } from '../../../middlewares/upload.middleware.js';
import * as sponsorAccountController from './sponsorAccount.controller.js';

const router = Router();

// All routes here require authentication via index.js router.use(verifyTokenAndTenant)
// But we add it here just in case this file is used elsewhere

router.get('/profile', sponsorAccountController.getProfile);
router.put('/profile', handleSponsorRegistrationUpload, sponsorAccountController.updateProfile);
router.put('/key-personnel', sponsorAccountController.updateKeyPersonnel);
router.post('/change-password', sponsorAccountController.changePassword);
router.get('/profile/documents/:field/download', sponsorAccountController.downloadProfileDocument);

export default router;
