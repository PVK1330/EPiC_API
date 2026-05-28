import { Router } from 'express';
import * as auth from './auth.controller.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { attachOrganisationContext } from '../../middlewares/organisationContext.middleware.js';
import {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resendOtpLimiter,
  verifyOtpLimiter,
  verify2FALimiter,
  globalAuthLimiter,
} from '../../middlewares/authRateLimiter.js';

const router = Router();

const withOrgContext = [attachOrganisationContext];
 
router.post("/register",       ...withOrgContext, registerLimiter,       auth.register);
router.post("/verify-otp",     ...withOrgContext, verifyOtpLimiter,      auth.verifyOTP);
router.post("/resend-otp",     ...withOrgContext, resendOtpLimiter,      auth.resendOTP);
router.post("/login",          ...withOrgContext, loginLimiter,          auth.login);
router.post("/logout",         globalAuthLimiter,                        auth.logout);
router.post("/forgot-password",...withOrgContext, forgotPasswordLimiter,  auth.forgotPassword);
router.post("/verify-reset-otp",...withOrgContext, globalAuthLimiter,    auth.verifyResetOTP);
router.post("/set-password",   ...withOrgContext, globalAuthLimiter,     auth.setPassword);
router.post("/resendOtpUser",  globalAuthLimiter,                        auth.resendOtpUser);
router.post("/verifyOtpUser",  globalAuthLimiter,                        auth.verifyOtpUser);
router.post("/send-password-change-otp", verifyTokenAndTenant, globalAuthLimiter, auth.sendPasswordChangeOtp);

// 2FA routes
router.post("/2fa/setup",        verifyTokenAndTenant, globalAuthLimiter, auth.setup2FA);
router.post("/2fa/verify-setup", verifyTokenAndTenant, globalAuthLimiter, auth.verify2FASetup);
router.post("/2fa/verify",       ...withOrgContext, verify2FALimiter,     auth.verify2FA);
router.post("/2fa/disable",      verifyTokenAndTenant, globalAuthLimiter, auth.disable2FA);

// Session restoration after page refresh (reads token from httpOnly cookie)
router.get("/me", verifyTokenAndTenant, auth.me);

// Cross-domain impersonation handoff (sets httpOnly cookie from token)
router.post("/handoff", auth.handoff);

export default router;
