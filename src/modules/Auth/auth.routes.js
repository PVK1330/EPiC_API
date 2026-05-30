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

import { validate } from '../../middlewares/validate.middleware.js';
import * as schema from '../../validations/auth.validation.js';

const router = Router();

const withOrgContext = [attachOrganisationContext];
 
router.post("/register",       ...withOrgContext, registerLimiter,       validate(schema.registerSchema),       auth.register);
router.post("/verify-otp",     ...withOrgContext, verifyOtpLimiter,      validate(schema.verifyOtpSchema),      auth.verifyOTP);
router.post("/resend-otp",     ...withOrgContext, resendOtpLimiter,      validate(schema.resendOtpSchema),      auth.resendOTP);
router.post("/login",          ...withOrgContext, loginLimiter,          validate(schema.loginSchema),          auth.login);
router.post("/logout",         globalAuthLimiter,                        auth.logout);
router.post("/logout-all",     verifyTokenAndTenant, globalAuthLimiter,  auth.logoutAll);
router.post("/refresh",        globalAuthLimiter,                        auth.refreshToken);
router.post("/forgot-password",...withOrgContext, forgotPasswordLimiter,  validate(schema.forgotPasswordSchema),  auth.forgotPassword);
router.post("/verify-reset-otp",...withOrgContext, globalAuthLimiter,    validate(schema.verifyResetOtpSchema),    auth.verifyResetOTP);
router.post("/set-password",   ...withOrgContext, globalAuthLimiter,     validate(schema.setPasswordSchema),     auth.setPassword);
router.post("/resendOtpUser",  globalAuthLimiter,                        validate(schema.resendOtpUserSchema),                        auth.resendOtpUser);
router.post("/verifyOtpUser",  globalAuthLimiter,                        validate(schema.verifyOtpUserSchema),                        auth.verifyOtpUser);
router.post("/send-password-change-otp", verifyTokenAndTenant, globalAuthLimiter, auth.sendPasswordChangeOtp);

// 2FA routes
router.post("/2fa/setup",        verifyTokenAndTenant, globalAuthLimiter, auth.setup2FA);
router.post("/2fa/verify-setup", verifyTokenAndTenant, globalAuthLimiter, validate(schema.verify2faSetupSchema), auth.verify2FASetup);
router.post("/2fa/verify",       ...withOrgContext, verify2FALimiter,     validate(schema.verify2faSchema),     auth.verify2FA);
router.post("/2fa/disable",      verifyTokenAndTenant, globalAuthLimiter, validate(schema.disable2faSchema), auth.disable2FA);

// Session restoration after page refresh (reads token from httpOnly cookie)
router.get("/me", verifyTokenAndTenant, auth.getMe);

// Cross-domain impersonation handoff (sets httpOnly cookie from token)
router.post("/handoff", auth.handoff);

export default router;
