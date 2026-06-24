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
  verifyResetOtpLimiter,
  verify2FALimiter,
  globalAuthLimiter,
  setPasswordLimiter,
} from '../../middlewares/authRateLimiter.js';

import { validate } from '../../middlewares/validate.middleware.js';
import * as schema from '../../validations/auth.validation.js';

const router = Router();

const withOrgContext = [attachOrganisationContext];

// NOTE: the global /api/auth/* catch-all limiter (50 req / 15 min per IP) is
// applied at the prefix in routes/index.js, so it covers every route below —
// including those without a stricter per-route limiter.

router.post("/register",       ...withOrgContext, registerLimiter,       validate(schema.registerSchema),       auth.register);
router.post("/verify-otp",     ...withOrgContext, verifyOtpLimiter,      validate(schema.verifyOtpSchema),      auth.verifyOTP);
router.post("/resend-otp",     ...withOrgContext, resendOtpLimiter,      validate(schema.resendOtpSchema),      auth.resendOTP);
router.post("/login",          ...withOrgContext, loginLimiter,          validate(schema.loginSchema),          auth.login);
// S-17 fix: logout and refresh also get the global rate limiter to prevent
// CSRF-style logout floods and token-stuffing on the refresh endpoint.
router.post("/logout",         globalAuthLimiter,                        auth.logout);
router.post("/logout-all",     verifyTokenAndTenant,                     auth.logoutAll);
router.post("/refresh",        globalAuthLimiter,                        auth.refreshToken);
router.post("/forgot-password",...withOrgContext, forgotPasswordLimiter,  validate(schema.forgotPasswordSchema),  auth.forgotPassword);
// S-16 fix: dedicated strict limiter for OTP brute-force on the reset flow.
router.post("/verify-reset-otp",...withOrgContext, verifyResetOtpLimiter, validate(schema.verifyResetOtpSchema),  auth.verifyResetOTP);
router.post("/set-password",   ...withOrgContext, setPasswordLimiter,    validate(schema.setPasswordSchema),     auth.setPassword);
router.post("/resendOtpUser",  ...withOrgContext, resendOtpLimiter,      validate(schema.resendOtpUserSchema),   auth.resendOtpUser);
router.post("/verifyOtpUser",  ...withOrgContext, verifyOtpLimiter,      validate(schema.verifyOtpUserSchema),   auth.verifyOtpUser);
router.post("/send-password-change-otp", verifyTokenAndTenant,          auth.sendPasswordChangeOtp);

// 2FA routes
router.post("/2fa/setup",        verifyTokenAndTenant,                   auth.setup2FA);
router.post("/2fa/verify-setup", verifyTokenAndTenant,                   validate(schema.verify2faSetupSchema), auth.verify2FASetup);
router.post("/2fa/verify",       ...withOrgContext, verify2FALimiter,     validate(schema.verify2faSchema),     auth.verify2FA);
router.post("/2fa/disable",      verifyTokenAndTenant,                   validate(schema.disable2faSchema), auth.disable2FA);

// Session restoration after page refresh (reads token from httpOnly cookie)
router.get("/me", verifyTokenAndTenant, auth.getMe);

// Cross-domain impersonation handoff (sets httpOnly cookie from token)
router.post("/handoff", validate(schema.handoffSchema), auth.handoff);

export default router;
