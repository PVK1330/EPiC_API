import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post("/register", auth.register);
router.post("/verify-otp", auth.verifyOTP); // unverified user
router.post("/resend-otp", auth.resendOTP); // unverified user
router.post("/login", auth.login);
router.post("/logout", auth.logout);
router.post("/forgot-password", auth.forgotPassword);
router.post("/verify-reset-otp", auth.verifyResetOTP);
router.post("/set-password", auth.setPassword);
router.post("/resendOtpUser", auth.resendOtpUser); // user table
router.post("/verifyOtpUser", auth.verifyOtpUser); // user table
router.post("/send-password-change-otp", verifyToken, auth.sendPasswordChangeOtp);

// 2FA routes
router.post("/2fa/setup", verifyToken, auth.setup2FA);
router.post("/2fa/verify-setup", verifyToken, auth.verify2FASetup);
router.post("/2fa/verify", auth.verify2FA);
router.post("/2fa/disable", verifyToken, auth.disable2FA);

export default router;