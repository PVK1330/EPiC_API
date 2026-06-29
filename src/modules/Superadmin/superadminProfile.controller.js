import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import catchAsync from '../../utils/catchAsync.js';
import ApiResponse from '../../utils/apiResponse.js';
import logger from '../../utils/logger.js';
import platformDb from '../../models/index.js';
import { mirrorUserToTenant } from '../../services/userSync.service.js';
import { getTenantDb } from '../../services/tenantDb.service.js';
import { toPublicImagePath } from '../../utils/storagePath.util.js';
import { buildJwtPayload } from '../../utils/tenantScope.js';
import { signToken, verifyToken, getCookieConfig } from '../../config/jwt.config.js';

async function mirrorSuperadminById(userId) {
  const user = await platformDb.User.findByPk(userId);
  if (!user?.organisation_id) return;
  const org = await platformDb.Organisation.findByPk(user.organisation_id, {
    attributes: ['database_name'],
  });
  if (!org?.database_name) return;
  await mirrorUserToTenant(getTenantDb(org.database_name), user);
}

function buildProfileResponse(user) {
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    mobile: user.mobile,
    country_code: user.country_code,
    profile_pic: user.profile_pic ?? null,
    two_factor_enabled: user.two_factor_enabled,
    role_id: user.role_id,
    status: user.status,
    organisation_id: user.organisation_id ?? null,
  };
}

export const getSuperadminProfile = catchAsync(async (req, res) => {
  const user = await platformDb.User.findByPk(req.user.id, {
    attributes: [
      'id', 'first_name', 'last_name', 'email', 'mobile',
      'country_code', 'profile_pic', 'two_factor_enabled', 'role_id', 'status',
    ],
  });

  if (!user) return ApiResponse.notFound(res, 'User not found');

  return ApiResponse.success(res, 'Profile retrieved', { user: buildProfileResponse(user) });
});

export const updateSuperadminProfile = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const user = await platformDb.User.findByPk(userId);

  if (!user) return ApiResponse.notFound(res, 'User not found');

  const { first_name, last_name, mobile, country_code } = req.body;

  const updates = {};
  if (first_name !== undefined) updates.first_name = String(first_name).trim();
  if (last_name !== undefined) updates.last_name = String(last_name).trim();
  if (mobile !== undefined) updates.mobile = String(mobile).trim();
  if (country_code !== undefined) updates.country_code = String(country_code).trim();

  if (Object.keys(updates).length === 0 && !req.file) {
    return ApiResponse.badRequest(res, 'No valid fields provided');
  }

  if (req.file) {
    updates.profile_pic = toPublicImagePath(req.file.path);
  }

  await user.update(updates);
  await mirrorSuperadminById(userId).catch((err) =>
    logger.warn({ err, userId }, 'Failed to mirror superadmin profile to tenant'),
  );

  return ApiResponse.success(res, 'Profile updated', { user: buildProfileResponse(user) });
});

export const uploadSuperadminAvatar = catchAsync(async (req, res) => {
  const userId = req.user.id;

  if (!req.file) return ApiResponse.badRequest(res, 'No image file received');

  const user = await platformDb.User.findByPk(userId);
  if (!user) return ApiResponse.notFound(res, 'User not found');

  const avatarUrl = toPublicImagePath(req.file.path);

  await user.update({ profile_pic: avatarUrl });
  await mirrorSuperadminById(userId).catch((err) =>
    logger.warn({ err, userId }, 'Failed to mirror superadmin profile to tenant'),
  );

  return ApiResponse.success(res, 'Avatar uploaded', { profile_pic: avatarUrl });
});

// Minimum days that must pass before the password can be changed again.
const PASSWORD_CHANGE_COOLDOWN_DAYS = 15;
const PASSWORD_CHANGE_COOLDOWN_MS = PASSWORD_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export const changeSuperadminPassword = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return ApiResponse.badRequest(res, 'currentPassword and newPassword are required');
  }

  if (newPassword.length < 8) {
    return ApiResponse.badRequest(res, 'New password must be at least 8 characters');
  }

  // New and confirm passwords must match. confirmPassword is optional for
  // backward compatibility, but when supplied it is enforced server-side too.
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return ApiResponse.badRequest(res, 'New password and confirm password do not match');
  }

  // New password must be different from the current one.
  if (currentPassword === newPassword) {
    return ApiResponse.badRequest(res, 'New password must be different from your current password');
  }

  const user = await platformDb.User.findByPk(userId);
  if (!user) return ApiResponse.notFound(res, 'User not found');

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return ApiResponse.badRequest(res, 'Your old password does not match');

  // Defense-in-depth: also reject if the new password equals the stored hash's
  // plaintext (covers the case where currentPassword was typed differently but
  // resolves to the same secret).
  const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
  if (sameAsCurrent) {
    return ApiResponse.badRequest(res, 'New password must be different from your current password');
  }

  // 15-day cooldown: once changed, the password cannot be changed again for 15 days.
  if (user.password_changed_at) {
    const lastChanged = new Date(user.password_changed_at).getTime();
    const elapsed = Date.now() - lastChanged;
    if (elapsed < PASSWORD_CHANGE_COOLDOWN_MS) {
      const daysLeft = Math.ceil((PASSWORD_CHANGE_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
      return ApiResponse.badRequest(
        res,
        `You can only change your password once every ${PASSWORD_CHANGE_COOLDOWN_DAYS} days. Please try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
      );
    }
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Sign the replacement token FIRST so we can align password_changed_at to its
  // issued-at (iat) second. auth.middleware.js rejects any JWT whose iat predates
  // password_changed_at; JWT iat is whole-seconds while new Date() is ms, so a
  // naive `new Date()` would be a few ms AFTER the freshly-signed token's iat and
  // would (incorrectly) invalidate the very token we just issued. Pinning
  // password_changed_at to iat*1000 keeps this new token valid while still
  // invalidating every older token (other devices/sessions stay logged out).
  const freshToken = signToken(buildJwtPayload(user, { name: req.user?.role_name }));
  const { iat } = verifyToken(freshToken);

  await user.update({
    password: hashedPassword,
    password_changed_at: new Date(iat * 1000),
  });

  await mirrorSuperadminById(userId).catch((err) =>
    logger.warn({ err, userId }, 'Failed to mirror superadmin profile to tenant'),
  );

  // Re-issue the fresh token cookie so the user who just changed their own
  // password stays logged in seamlessly.
  res.cookie('token', freshToken, getCookieConfig({ maxAge: 7 * 24 * 60 * 60 * 1000 }));

  return ApiResponse.success(res, 'Password updated successfully');
});

export const setup2FAForSuperadmin = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const user = await platformDb.User.findByPk(userId);

  if (!user) return ApiResponse.notFound(res, 'User not found');

  const label = `ElitePic (${user.email})`;
  const issuer = 'ElitePic SuperAdmin';

  // Idempotent setup: if 2FA is NOT yet enabled and a pending secret already
  // exists (e.g. the user clicked "Activate" twice, refreshed, or React dev
  // StrictMode double-invoked the handler), REUSE that secret instead of minting
  // a new one. Regenerating would clobber the secret the user already scanned
  // into their authenticator, so their codes would never match the DB — the
  // exact "Invalid verification token" symptom. We only mint a fresh secret when
  // 2FA is already enabled (re-enrolment) or none exists yet.
  let base32 = user.two_factor_secret;
  let otpauthUrl;
  if (user.two_factor_enabled || !base32) {
    const secret = speakeasy.generateSecret({ name: label, issuer });
    base32 = secret.base32;
    otpauthUrl = secret.otpauth_url;
    await user.update({ two_factor_secret: base32 });
  } else {
    otpauthUrl = speakeasy.otpauthURL({
      secret: base32,
      encoding: 'base32',
      label,
      issuer,
    });
  }

  const dataURL = await QRCode.toDataURL(otpauthUrl);

  return ApiResponse.success(res, '2FA setup initiated', {
    qrCode: dataURL,
    // RE-01 fix: secret omitted — QR code already encodes it; returning the
    // raw base32 seed would allow permanent 2FA bypass if the response is intercepted.
  });
});

export const verify2FASetupForSuperadmin = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const token = String(req.body?.token ?? '').replace(/\s+/g, '');

  if (!token) return ApiResponse.badRequest(res, 'Verification token is required');

  const user = await platformDb.User.findByPk(userId);
  if (!user || !user.two_factor_secret) {
    return ApiResponse.badRequest(res, '2FA setup not initiated');
  }

  const verified = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: 'base32',
    token,
    // window:1 tolerates ±30s of clock drift between the server and the user's
    // phone (a code from the previous/next 30s step still verifies). Without it,
    // even a correct code fails when clocks are slightly out of sync.
    window: 1,
  });

  if (!verified) return ApiResponse.badRequest(res, 'Invalid verification token');

  await user.update({ two_factor_enabled: true });
  await mirrorSuperadminById(userId).catch((err) =>
    logger.warn({ err, userId }, 'Failed to mirror superadmin profile to tenant'),
  );

  return ApiResponse.success(res, '2FA enabled successfully');
});

export const disable2FAForSuperadmin = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { password } = req.body;
  const token = String(req.body?.token ?? '').replace(/\s+/g, '');

  if (!token && !password) {
    return ApiResponse.badRequest(res, 'Either a TOTP token or current password is required');
  }

  const user = await platformDb.User.findByPk(userId);
  if (!user) return ApiResponse.notFound(res, 'User not found');

  if (!user.two_factor_enabled) {
    return ApiResponse.badRequest(res, '2FA is not currently enabled');
  }

  if (token) {
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) return ApiResponse.badRequest(res, 'Invalid TOTP token');
  } else {
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return ApiResponse.badRequest(res, 'Incorrect password');
  }

  await user.update({
    two_factor_enabled: false,
    two_factor_secret: null,
  });
  await mirrorSuperadminById(userId).catch((err) =>
    logger.warn({ err, userId }, 'Failed to mirror superadmin profile to tenant'),
  );

  return ApiResponse.success(res, '2FA disabled successfully');
});
