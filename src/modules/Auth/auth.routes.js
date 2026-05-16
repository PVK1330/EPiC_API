import { Router } from 'express';
import * as auth from './auth.controller.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { attachOrganisationContext } from '../../middlewares/organisationContext.middleware.js';
const router = Router();

const withOrgContext = [attachOrganisationContext];

router.post("/register", ...withOrgContext, auth.register);
router.post("/verify-otp", ...withOrgContext, auth.verifyOTP); // unverified user
router.post("/resend-otp", ...withOrgContext, auth.resendOTP); // unverified user
router.post("/login", ...withOrgContext, auth.login);
router.post("/logout", auth.logout);
router.post("/forgot-password", auth.forgotPassword);
router.post("/verify-reset-otp", auth.verifyResetOTP);
router.post("/set-password", auth.setPassword);
router.post("/resendOtpUser", auth.resendOtpUser); // user table
router.post("/verifyOtpUser", auth.verifyOtpUser); // user table
router.post("/send-password-change-otp", verifyTokenAndTenant, auth.sendPasswordChangeOtp);

// 2FA routes
router.post("/2fa/setup", verifyTokenAndTenant, auth.setup2FA);
router.post("/2fa/verify-setup", verifyTokenAndTenant, auth.verify2FASetup);
router.post("/2fa/verify", ...withOrgContext, auth.verify2FA);
router.post("/2fa/disable", verifyTokenAndTenant, auth.disable2FA);

export default router;
