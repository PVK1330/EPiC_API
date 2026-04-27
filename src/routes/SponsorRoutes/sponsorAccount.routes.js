import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { handleSponsorRegistrationUpload } from '../../middlewares/upload.middleware.js';
import * as sponsorAccountController from '../../controllers/SponsorControllers/sponsorAccount.controller.js';

const router = Router();

// All routes here require authentication via index.js router.use(verifyToken)
// But we add it here just in case this file is used elsewhere

router.get('/profile', sponsorAccountController.getProfile);
router.put('/profile', handleSponsorRegistrationUpload, sponsorAccountController.updateProfile);
router.put('/key-personnel', sponsorAccountController.updateKeyPersonnel);
router.post('/change-password', sponsorAccountController.changePassword);

export default router;
