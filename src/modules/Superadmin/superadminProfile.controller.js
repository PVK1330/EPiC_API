import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import path from 'path';
import catchAsync from '../../utils/catchAsync.js';
import ApiResponse from '../../utils/apiResponse.js';
import platformDb from '../../models/index.js';
import { mirrorUserToTenant } from '../../services/userSync.service.js';
import { getTenantDb } from '../../services/tenantDb.service.js';

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
    const relativePath = req.file.path.replace(/\\/g, '/');
    const baseUrl = String(process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
    updates.profile_pic = `${baseUrl}/${relativePath}`;
  }

  await user.update(updates);
  await mirrorSuperadminById(userId).catch(() => {});

  return ApiResponse.success(res, 'Profile updated', { user: buildProfileResponse(user) });
});

export const uploadSuperadminAvatar = catchAsync(async (req, res) => {
  const userId = req.user.id;

  if (!req.file) return ApiResponse.badRequest(res, 'No image file received');

  const user = await platformDb.User.findByPk(userId);
  if (!user) return ApiResponse.notFound(res, 'User not found');

  const relativePath = req.file.path.replace(/\\/g, '/');
  const baseUrl = String(process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
  const avatarUrl = `${baseUrl}/${relativePath}`;

  await user.update({ profile_pic: avatarUrl });
  await mirrorSuperadminById(userId).catch(() => {});

  return ApiResponse.success(res, 'Avatar uploaded', { profile_pic: avatarUrl });
});

export const changeSuperadminPassword = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return ApiResponse.badRequest(res, 'currentPassword and newPassword are required');
  }

  if (newPassword.length < 8) {
    return ApiResponse.badRequest(res, 'New password must be at least 8 characters');
  }

  const user = await platformDb.User.findByPk(userId);
  if (!user) return ApiResponse.notFound(res, 'User not found');

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return ApiResponse.badRequest(res, 'Current password is incorrect');

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await user.update({
    password: hashedPassword,
    password_changed_at: new Date(),
  });

  await mirrorSuperadminById(userId).catch(() => {});

  return ApiResponse.success(res, 'Password updated successfully');
});

export const setup2FAForSuperadmin = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const user = await platformDb.User.findByPk(userId);

  if (!user) return ApiResponse.notFound(res, 'User not found');

  const secret = speakeasy.generateSecret({ name: `ElitePic (${user.email})` });
  const dataURL = await QRCode.toDataURL(secret.otpauth_url);

  await user.update({ two_factor_secret: secret.base32 });

  return ApiResponse.success(res, '2FA setup initiated', {
    qrCode: dataURL,
    secret: secret.base32,
  });
});

export const verify2FASetupForSuperadmin = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { token } = req.body;

  if (!token) return ApiResponse.badRequest(res, 'Verification token is required');

  const user = await platformDb.User.findByPk(userId);
  if (!user || !user.two_factor_secret) {
    return ApiResponse.badRequest(res, '2FA setup not initiated');
  }

  const verified = speakeasy.totp.verify({
    secret: user.two_factor_secret,
    encoding: 'base32',
    token,
  });

  if (!verified) return ApiResponse.badRequest(res, 'Invalid verification token');

  await user.update({ two_factor_enabled: true });
  await mirrorSuperadminById(userId).catch(() => {});

  return ApiResponse.success(res, '2FA enabled successfully');
});

export const disable2FAForSuperadmin = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { token, password } = req.body;

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
  await mirrorSuperadminById(userId).catch(() => {});

  return ApiResponse.success(res, '2FA disabled successfully');
});
