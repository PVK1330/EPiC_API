import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import catchAsync from '../../utils/catchAsync.js';
import ApiResponse from '../../utils/apiResponse.js';
import platformDb from '../../models/index.js';
import transporter from '../../config/mail.js';
import { generateOTPTemplate, generateCredentialsTemplate } from '../../utils/emailTemplates.js';
import { ensureCandidateEnquiryCase } from '../../services/candidateOnboarding.service.js';
import { buildTenantFrontendUrls } from '../../utils/organisationHost.js';
import { buildJwtPayload, resolveDefaultOrganisationId, isSuperAdminRole } from '../../utils/tenantScope.js';
import { getTenantDb } from '../../services/tenantDb.service.js';
import { assertLoginAllowedForOrganisationContext } from '../../utils/organisationHost.js';
import {
  createUserOnPlatformAndTenant,
  ensureUserOnPlatformFromTenant,
  mirrorUserToTenant,
  syncUserToPlatformAndTenant,
} from '../../services/userSync.service.js';

const RESET_TOKEN_EXPIRY = '10m';
const RESET_TOKEN_PURPOSE = 'password_reset';

const ROLE_NAMES = {
  1: 'candidate',
  2: 'caseworker',
  3: 'admin',
  4: 'business',
  5: 'superadmin',
};

async function resolveDefaultTenantDb() {
  const orgId = await resolveDefaultOrganisationId();
  if (!orgId) return { orgId: null, tenantDb: null };
  const org = await platformDb.Organisation.findByPk(orgId, {
    attributes: ['database_name', 'status', 'slug'],
  });
  if (!org?.database_name) return { orgId, tenantDb: null };
  if (org.status === 'suspended') {
    const err = new Error('Organisation suspended.');
    err.status = 403;
    throw err;
  }
  return { orgId, tenantDb: getTenantDb(org.database_name) };
}

/** Tenant DB for register/OTP: subdomain org first, else DEFAULT_ORGANISATION_ID / first active org. */
async function resolveTenantDbForAuth(req) {
  const ctx = req.organisationContext;

  if (ctx?.slug && !ctx?.organisation) {
    const err = new Error('Organisation not found.');
    err.status = 404;
    throw err;
  }

  if (ctx?.organisation) {
    const org = ctx.organisation;
    if (org.status === 'suspended') {
      const err = new Error('Organisation suspended.');
      err.status = 403;
      throw err;
    }
    if (!org.database_name) {
      const err = new Error('Tenant database not provisioned for this organisation.');
      err.status = 503;
      throw err;
    }
    return { orgId: org.id, tenantDb: getTenantDb(org.database_name) };
  }

  return resolveDefaultTenantDb();
}

async function mirrorPlatformUserById(userId) {
  const user = await platformDb.User.findByPk(userId);
  if (!user?.organisation_id) return;
  const org = await platformDb.Organisation.findByPk(user.organisation_id, {
    attributes: ['database_name'],
  });
  if (!org?.database_name) return;
  await mirrorUserToTenant(getTenantDb(org.database_name), user);
}

/**
 * Register a new user (Unverified)
 */
export const register = catchAsync(async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    password,
    country_code,
    mobile,
    role_id,
  } = req.body;

  if (!first_name || !last_name) {
    return ApiResponse.badRequest(res, "First name and last name are required");
  }

  if (!password || password.length < 8) {
    return ApiResponse.badRequest(res, "Password must be at least 8 characters");
  }

  const emailExists = await platformDb.User.findOne({ where: { email } });
  if (emailExists) {
    return ApiResponse.badRequest(res, "Email already exists");
  }

  const { tenantDb } = await resolveTenantDbForAuth(req);
  if (!tenantDb) {
    return ApiResponse.error(
      res,
      "Registration unavailable. Use your organisation sign-up URL or ask an administrator to create your organisation.",
      503,
    );
  }

  const mobileExists = await platformDb.User.findOne({
    where: { country_code, mobile },
  });

  if (mobileExists) {
    return ApiResponse.badRequest(res, "Mobile number already exists");
  }

  const { UnverifiedUser } = tenantDb;
  const unverifiedEmailExists = await UnverifiedUser.findOne({ where: { email } });
  if (unverifiedEmailExists) {
    return ApiResponse.badRequest(res, "Registration already in progress. Please verify your OTP or request a new one.", { email, pending_verification: true });
  }

  const unverifiedMobileExists = await UnverifiedUser.findOne({
    where: { country_code, mobile },
  });
  if (unverifiedMobileExists) {
    return ApiResponse.badRequest(res, "Mobile number already registered and pending OTP verification.");
  }

  const validRoles = [1, 2, 3, 4];
  if (!validRoles.includes(role_id)) {
    return ApiResponse.badRequest(res, "Invalid role_id (allowed: 1,2,3,4)");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  await UnverifiedUser.create({
    first_name,
    last_name,
    email,
    password: hashedPassword,
    country_code,
    mobile,
    role_id,
    otp_code: otp,
    otp_expiry: otpExpiry,
    temp_password: null,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Elite Pic - OTP Verification",
    html: generateOTPTemplate(otp),
  });

  return ApiResponse.created(res, "User registered successfully", {
    email: email,
    otp_sent: true
  });
});

/**
 * Verify OTP and activate user
 */
export const verifyOTP = catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  const { orgId, tenantDb } = await resolveTenantDbForAuth(req);
  if (!tenantDb) {
    return ApiResponse.error(
      res,
      "Registration unavailable. Use your organisation sign-up URL or ask an administrator to create your organisation.",
      503,
    );
  }
  
  const { UnverifiedUser } = tenantDb;
  const unverifiedUser = await UnverifiedUser.findOne({ where: { email } });

  if (!unverifiedUser) {
    return ApiResponse.notFound(res, "User not found or already verified");
  }

  if (unverifiedUser.otp_code !== otp) {
    return ApiResponse.badRequest(res, "Invalid OTP");
  }

  if (new Date() > unverifiedUser.otp_expiry) {
    return ApiResponse.badRequest(res, "OTP expired");
  }

  if (!orgId) {
    return ApiResponse.error(res, "Registration unavailable: no default organisation configured.", 503);
  }

  const orgRow = await platformDb.Organisation.findByPk(orgId, { attributes: ["slug"] });
  const loginUrl = orgRow?.slug
    ? `${buildTenantFrontendUrls(orgRow.slug).subdomain}/login`
    : `${process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173"}/login`;

  const verifiedUser = await createUserOnPlatformAndTenant(tenantDb, {
    first_name: unverifiedUser.first_name,
    last_name: unverifiedUser.last_name,
    email: unverifiedUser.email,
    password: unverifiedUser.password,
    country_code: unverifiedUser.country_code,
    mobile: unverifiedUser.mobile,
    role_id: unverifiedUser.role_id,
    is_otp_verified: true,
    is_email_verified: true,
    status: "active",
    organisation_id: orgId,
  });

  if (Number(verifiedUser.role_id) === 1) {
    await ensureCandidateEnquiryCase(tenantDb, verifiedUser.id);
  }

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "EPiC — Account verified",
      html: generateCredentialsTemplate(
        email,
        "Use the password you chose during registration",
        loginUrl,
      ),
    });
  }

  await unverifiedUser.destroy();

  const role = { name: ROLE_NAMES[verifiedUser.role_id] ?? null };
  const payload = buildJwtPayload(verifiedUser, role);
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

  const userResponse = {
    id: verifiedUser.id,
    first_name: verifiedUser.first_name,
    last_name: verifiedUser.last_name,
    email: verifiedUser.email,
    country_code: verifiedUser.country_code,
    mobile: verifiedUser.mobile,
    role_id: verifiedUser.role_id,
    organisation_id: verifiedUser.organisation_id,
    is_otp_verified: verifiedUser.is_otp_verified,
    createdAt: verifiedUser.createdAt,
  };

  return ApiResponse.success(res, "Email verified successfully. You are now logged in!", {
    email: email,
    is_verified: true,
    credentials_sent: true,
    token: token,
    user: userResponse
  });
});

/**
 * Resend OTP for registration
 */
export const resendOTP = catchAsync(async (req, res) => {
  const { email } = req.body;
  const verifiedUser = await platformDb.User.findOne({ where: { email } });
  if (verifiedUser) {
    return ApiResponse.badRequest(res, "User already verified. Please login instead.");
  }

  const { tenantDb } = await resolveTenantDbForAuth(req);
  if (!tenantDb) {
    return ApiResponse.error(
      res,
      "Registration unavailable. Use your organisation sign-up URL or ask an administrator to create your organisation.",
      503,
    );
  }
  const { UnverifiedUser } = tenantDb;
  const unverifiedUser = await UnverifiedUser.findOne({ where: { email } });
  if (!unverifiedUser) {
    return ApiResponse.notFound(res, "User not found. Please register first.");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  unverifiedUser.otp_code = otp;
  unverifiedUser.otp_expiry = otpExpiry;
  await unverifiedUser.save();

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Elite Pic - OTP Verification",
    html: generateOTPTemplate(otp),
  });

  return ApiResponse.success(res, "OTP resent successfully", {
    email: email,
    otp_sent: true
  });
});

/**
 * Login
 */
export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return ApiResponse.badRequest(res, 'Email and password are required.');
  }

  const emailNorm = String(email).trim().toLowerCase();
  let user = await platformDb.User.findOne({ where: { email: emailNorm } });

  if (!user && req.organisationContext?.organisation?.database_name) {
    const tenantDb = getTenantDb(req.organisationContext.organisation.database_name);
    const tenantUser = await tenantDb.User.findOne({ where: { email: emailNorm } });
    if (tenantUser) {
      user = await ensureUserOnPlatformFromTenant(
        tenantDb,
        tenantUser.id,
        req.organisationContext.organisation.id,
      );
    }
  }

  if (!user) {
    return ApiResponse.unauthorized(res, 'Invalid credentials.');
  }

  if (user.organisation_id) {
    const org = await platformDb.Organisation.findByPk(user.organisation_id, {
      attributes: ['status'],
    });
    if (org?.status === 'suspended') {
      return ApiResponse.forbidden(res, 'Organisation suspended.');
    }
  }

  if (user.status !== 'active') {
    return ApiResponse.forbidden(res, 'Account is inactive or suspended.');
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return ApiResponse.unauthorized(res, 'Invalid credentials.');
  }

  try {
    assertLoginAllowedForOrganisationContext(user, req.organisationContext);
  } catch (orgErr) {
    return ApiResponse.forbidden(res, orgErr.message);
  }

  if (user.two_factor_enabled) {
    return ApiResponse.success(res, '2FA verification required', {
      requires_2fa: true,
      email: user.email,
    });
  }

  const role = { name: ROLE_NAMES[user.role_id] ?? null };
  const payload = buildJwtPayload(user, role);
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

  let organisation = null;
  if (user.organisation_id && !isSuperAdminRole(user.role_id)) {
    const org = await platformDb.Organisation.findByPk(user.organisation_id, {
      attributes: ['id', 'slug', 'name', 'status'],
    });
    if (org) {
      organisation = { id: org.id, slug: org.slug, name: org.name, status: org.status };
    }
  }

  return ApiResponse.success(res, 'Login successful.', {
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role_id: user.role_id,
      role_name: ROLE_NAMES[user.role_id] ?? null,
      organisation_id: user.organisation_id,
      organisation,
      status: user.status,
      two_factor_enabled: user.two_factor_enabled,
    },
    token,
  });
});

/**
 * Logout
 */
export const logout = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  return ApiResponse.success(res, 'Logged out successfully.');
};

/**
 * Forgot Password - Send OTP
 */
export const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await platformDb.User.findOne({ where: { email } });

  if (!user) {
    return ApiResponse.notFound(res, "User not found");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  user.password_reset_otp = otp;
  user.password_reset_otp_expiry = otpExpiry;
  await user.save();
  await mirrorPlatformUserById(user.id);

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Elite Pic - Password Reset OTP",
    html: generateOTPTemplate(otp),
  });

  return ApiResponse.success(res, "Password reset OTP sent to your email", {
    email: email,
    otp_sent: true,
    next_step: "verify_otp"
  });
});

/**
 * Verify Password Reset OTP
 */
export const verifyResetOTP = catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  const user = await platformDb.User.findOne({ where: { email } });

  if (!user) {
    return ApiResponse.notFound(res, "User not found");
  }

  if (user.password_reset_otp !== otp) {
    return ApiResponse.badRequest(res, "Invalid OTP");
  }

  if (new Date() > user.password_reset_otp_expiry) {
    return ApiResponse.badRequest(res, "OTP expired");
  }

  const resetToken = jwt.sign(
    { email: user.email, purpose: RESET_TOKEN_PURPOSE },
    process.env.JWT_SECRET,
    { expiresIn: RESET_TOKEN_EXPIRY }
  );

  return ApiResponse.success(res, "OTP verified successfully", {
    email: email,
    otp_verified: true,
    next_step: "set_password",
    reset_token: resetToken
  });
});

/**
 * Set New Password using Reset Token
 */
export const setPassword = catchAsync(async (req, res) => {
  const { email, password, confirmPassword, resetToken } = req.body;
  const user = await platformDb.User.findOne({ where: { email } });

  if (!user) {
    return ApiResponse.notFound(res, "User not found");
  }

  if (!resetToken) {
    return ApiResponse.badRequest(res, "Reset token is required");
  }

  let decodedResetToken;
  try {
    decodedResetToken = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch {
    return ApiResponse.unauthorized(res, "Invalid or expired reset token");
  }

  if (
    decodedResetToken?.purpose !== RESET_TOKEN_PURPOSE ||
    decodedResetToken?.email !== email
  ) {
    return ApiResponse.unauthorized(res, "Invalid reset token");
  }

  if (!user.password_reset_otp || new Date() > user.password_reset_otp_expiry) {
    return ApiResponse.badRequest(res, "OTP verification required or expired");
  }

  if (!password || !confirmPassword) {
    return ApiResponse.badRequest(res, "Password and confirm password are required");
  }

  if (password !== confirmPassword) {
    return ApiResponse.badRequest(res, "Passwords do not match");
  }

  if (password.length < 8) {
    return ApiResponse.badRequest(res, "Password must be at least 8 characters");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  user.password = hashedPassword;
  user.password_reset_otp = null;
  user.password_reset_otp_expiry = null;
  await user.save();
  await mirrorPlatformUserById(user.id);

  const loginUrl = `${process.env.FRONTEND_URL}`;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Elite Pic - Password Updated Successfully",
    html: `<p>Your password was updated successfully.</p><p>You can now log in at <a href="${loginUrl}">${loginUrl}</a>.</p>`,
  });

  return ApiResponse.success(res, "Password updated successfully", {
    email: email,
    password_updated: true,
    credentials_sent: true
  });
});

/**
 * Resend OTP for authenticated user
 */
export const resendOtpUser = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await platformDb.User.findOne({ where: { email } });

  if (!user) {
    return ApiResponse.notFound(res, "User not found");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  user.otp_code = otp;
  user.otp_expiry = otpExpiry;
  await user.save();
  await mirrorPlatformUserById(user.id);

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Elite Pic - OTP Verification",
    html: generateOTPTemplate(otp),
  });

  return ApiResponse.success(res, "OTP sent successfully", { email });
});

/**
 * Verify OTP for authenticated user
 */
export const verifyOtpUser = catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  const user = await platformDb.User.findOne({ where: { email } });

  if (!user) {
    return ApiResponse.notFound(res, "User not found");
  }

  if (user.otp_code !== otp) {
    return ApiResponse.badRequest(res, "Invalid OTP");
  }

  if (new Date() > user.otp_expiry) {
    return ApiResponse.badRequest(res, "OTP expired");
  }

  user.is_otp_verified = true;
  user.otp_code = null;
  user.otp_expiry = null;
  await user.save();
  await mirrorPlatformUserById(user.id);

  return ApiResponse.success(res, "OTP verified successfully", {
    email: email,
    is_verified: true
  });
});

/**
 * Send OTP for password change
 */
export const sendPasswordChangeOtp = catchAsync(async (req, res) => {
  const userId = req.user.userId;
  const user = await req.tenantDb.User.findByPk(userId);

  if (!user) {
    return ApiResponse.notFound(res, "User not found");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  user.otp_code = otp;
  user.otp_expiry = otpExpiry;
  await user.save();
  await mirrorPlatformUserById(userId);

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: "Elite Pic - Password Change OTP",
    html: generateOTPTemplate(otp),
  });

  return ApiResponse.success(res, "OTP sent successfully", { email: user.email });
});

/**
 * 2FA - Setup
 */
export const setup2FA = catchAsync(async (req, res) => {
  const userId = req.user.userId;
  const user = await platformDb.User.findByPk(userId);

  if (!user) return ApiResponse.notFound(res, 'User not found');

  const secret = speakeasy.generateSecret({ name: `ElitePic (${user.email})` });
  const dataURL = await QRCode.toDataURL(secret.otpauth_url);

  await user.update({
    two_factor_secret: secret.base32,
  });

  return ApiResponse.success(res, '2FA setup initiated', {
    qrCode: dataURL,
    secret: secret.base32,
  });
});

/**
 * 2FA - Verify Setup
 */
export const verify2FASetup = catchAsync(async (req, res) => {
  const userId = req.user.userId;
  const { token } = req.body;
  const user = await platformDb.User.findByPk(userId);

  if (!user || !user.two_factor_secret) return ApiResponse.badRequest(res, '2FA setup not initiated');

  const verified = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: 'base32',
    token,
  });

  if (!verified) return ApiResponse.badRequest(res, 'Invalid verification token');

  await user.update({ two_factor_enabled: true });
  await mirrorPlatformUserById(userId);

  return ApiResponse.success(res, '2FA enabled successfully');
});

/**
 * 2FA - Verify Login
 */
export const verify2FA = catchAsync(async (req, res) => {
  const { email, token } = req.body;
  const user = await platformDb.User.findOne({ where: { email } });

  if (!user || !user.two_factor_secret) return ApiResponse.badRequest(res, '2FA not enabled');

  const verified = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: 'base32',
    token,
  });

  if (!verified) return ApiResponse.unauthorized(res, 'Invalid 2FA token');

  try {
    assertLoginAllowedForOrganisationContext(user, req.organisationContext);
  } catch (orgErr) {
    return ApiResponse.forbidden(res, orgErr.message);
  }

  const role = { name: ROLE_NAMES[user.role_id] ?? null };
  const payload = buildJwtPayload(user, role);
  const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

  let organisation = null;
  if (user.organisation_id && !isSuperAdminRole(user.role_id)) {
    const org = await platformDb.Organisation.findByPk(user.organisation_id, {
      attributes: ['id', 'slug', 'name', 'status'],
    });
    if (org) {
      organisation = { id: org.id, slug: org.slug, name: org.name, status: org.status };
    }
  }

  return ApiResponse.success(res, '2FA verified, login successful', {
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role_id: user.role_id,
      role_name: ROLE_NAMES[user.role_id] ?? null,
      organisation_id: user.organisation_id,
      organisation,
      status: user.status,
      two_factor_enabled: true,
    },
    token: jwtToken,
  });
});

/**
 * 2FA - Disable
 */
export const disable2FA = catchAsync(async (req, res) => {
  const userId = req.user.userId;
  const user = await platformDb.User.findByPk(userId);

  if (!user) return ApiResponse.notFound(res, 'User not found');

  await user.update({
    two_factor_enabled: false,
    two_factor_secret: null,
  });
  await mirrorPlatformUserById(userId);

  return ApiResponse.success(res, '2FA disabled successfully');
});
