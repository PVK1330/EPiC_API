import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { Op } from 'sequelize';

import logger from '../../../utils/logger.js';
import { toPublicImagePath } from '../../../utils/storagePath.util.js';

/**
 * Resolve user ID from request
 */
function resolveUserId(req) {
  const raw = req.user?.userId;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

/**
 * Sensitive attributes to exclude
 */
function excludeSensitiveUserAttrs() {
  return {
    exclude: [
      'password',
      'otp_code',
      'otp_expiry',
      'password_reset_otp',
      'password_reset_otp_expiry',
      'temp_password',
      'two_factor_secret',
      'two_factor_backup_codes',
    ],
  };
}

/**
 * Get Sponsor Profile
 */
export const getProfile = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    logger.info({ userId }, 'getProfile');
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session' });
    }

    const user = await req.tenantDb.User.findOne({
      where: { id: userId },
      attributes: excludeSensitiveUserAttrs(),
      include: [
        {
          model: req.tenantDb.SponsorProfile,
          as: 'sponsorProfile',
        },
        {
          model: req.tenantDb.SponsorUserPreference,
          as: 'sponsorPreferences',
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Ensure sponsor profile exists
    let profile = user.sponsorProfile;
    if (!profile) {
      const [resProfile] = await req.tenantDb.SponsorProfile.findOrCreate({
        where: { userId },
        defaults: { userId }
      });
      profile = resProfile;
    }

    // Ensure preferences exist
    let preferences = user.sponsorPreferences;
    if (!preferences) {
      const [resPref] = await req.tenantDb.SponsorUserPreference.findOrCreate({
        where: { userId },
        defaults: { userId }
      });
      preferences = resPref;
    }

    res.status(200).json({
      status: 'success',
      message: 'Profile loaded',
      data: {
        user: {
          ...user.toJSON(),
          profile_pic: user.profile_pic ? toPublicImagePath(user.profile_pic) : null,
        },
        profile: profile,
        preferences: preferences,
      },
    });
  } catch (err) {
    logger.error({ err }, 'getProfile error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: err.message,
    });
  }
};

/**
 * Update Sponsor Profile
 */
export const updateProfile = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    logger.info({ userId }, 'updateProfile');
    
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session' });
    }

    const profileUpdate = {};
    const { 
      // User fields
      first_name, last_name, country_code, mobile, gender,
      // Key required fields for validation
      companyName, registrationNumber
    } = req.body || {};

    // Basic Validation for Registration
    if (req.body.isFullRegistration && (!companyName || !registrationNumber)) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Company Name and Registration Number are required for full registration.' 
      });
    }

    const user = await req.tenantDb.User.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Update User fields
    const userUpdate = {};
    if (first_name) userUpdate.first_name = first_name;
    if (last_name) userUpdate.last_name = last_name;
    if (country_code) userUpdate.country_code = country_code;
    if (mobile) userUpdate.mobile = mobile;
    if (gender) userUpdate.gender = gender;

    // Handle multiple file uploads
    if (req.files) {
      const userDir = path.join('uploads', 'sponsor_docs', String(userId));
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      // Profile pic — move into the served avatars dir and store the public path.
      if (req.files['profile_pic']?.[0]) {
        const file = req.files['profile_pic'][0];
        const avatarDir = path.join('storage', 'private', 'avatars');
        fs.mkdirSync(avatarDir, { recursive: true });
        const avatarPath = path.join(avatarDir, file.filename);
        fs.renameSync(file.path, avatarPath);
        userUpdate.profile_pic = toPublicImagePath(avatarPath);
      }

      // Registration Documents (matching field names to model keys)
      const docFields = [
        { name: 'sponsorLetter', modelKey: 'sponsorLetter' },
        { name: 'insuranceCertificate', modelKey: 'insuranceCertificate' },
        { name: 'hrPolicies', modelKey: 'hrPolicies' },
        { name: 'organisationalChart', modelKey: 'organisationalChart' },
        { name: 'recruitmentDocs', modelKey: 'recruitmentDocs' }
      ];

      docFields.forEach(doc => {
        if (req.files[doc.name]?.[0]) {
          const file = req.files[doc.name][0];
          const targetPath = path.join(userDir, `${doc.name}_${file.filename}`);
          fs.renameSync(file.path, targetPath);
          profileUpdate[doc.modelKey] = targetPath.replace(/\\/g, '/');
        }
      });
    }

    if (Object.keys(userUpdate).length > 0) {
      await req.tenantDb.User.update(userUpdate, { where: { id: userId } });
    }

    // Update SponsorProfile fields
    const [profile] = await req.tenantDb.SponsorProfile.findOrCreate({
      where: { userId },
    });

    const profileFields = [
      'companyName', 'tradingName', 'registrationNumber', 'sponsorLicenceNumber',
      'licenceRating', 'industrySector', 'yearEstablished', 'website', 
      'registeredAddress', 'tradingAddress', 'city', 'state', 'country', 'postalCode',
      'authorisingName', 'authorisingPhone', 'authorisingEmail', 'authorisingJobTitle',
      'keyContactName', 'keyContactPhone', 'keyContactEmail', 'keyContactDepartment',
      'hrName', 'hrEmail', 'hrPhone', 'hrJobTitle',
      // licenceStatus is intentionally NOT writable here — it is owned solely by
      // the licence activation workflow (activateSponsorLicence). A sponsor must
      // never be able to set their own licence status via the registration form.
      'licenceIssueDate', 'licenceExpiryDate', 'cosAllocation',
      'billingName', 'billingEmail', 'billingPhone', 'outstandingBalance', 'paymentTerms',
      'ownershipType', 'shareholders', 'directors', 'level1Users', 'notes'
    ];

    profileFields.forEach(field => {
      if (req.body[field] !== undefined) {
        let value = req.body[field];
        
        // Convert empty strings to null (important for DATE and ENUM fields)
        if (value === "") {
          value = null;
        }

        // Handle JSON strings if sent as form-data
        if (['shareholders', 'directors', 'level1Users'].includes(field) && typeof value === 'string' && value !== null) {
          try {
            profileUpdate[field] = JSON.parse(value);
          } catch (e) {
            logger.warn({ field, value }, 'Failed to parse JSON');
          }
        } else {
          profileUpdate[field] = value;
        }
      }
    });

    if (Object.keys(profileUpdate).length > 0) {
      logger.info({ profileUpdate }, 'updateProfile - applying changes');
      await profile.update(profileUpdate);
    }

    // Update Preferences if provided
    if (req.body.preferences) {
      const [pref] = await req.tenantDb.SponsorUserPreference.findOrCreate({ where: { userId } });
      const prefData = typeof req.body.preferences === 'string' ? JSON.parse(req.body.preferences) : req.body.preferences;
      await pref.update(prefData);
    }

    // Fetch updated data
    const updatedUser = await req.tenantDb.User.findOne({
      where: { id: userId },
      attributes: excludeSensitiveUserAttrs(),
      include: [
        { model: req.tenantDb.SponsorProfile, as: 'sponsorProfile' },
        { model: req.tenantDb.SponsorUserPreference, as: 'sponsorPreferences' }
      ]
    });

    if (updatedUser.profile_pic) {
      updatedUser.profile_pic = toPublicImagePath(updatedUser.profile_pic);
    }

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user: updatedUser,
        profile: updatedUser.sponsorProfile,
        preferences: updatedUser.sponsorPreferences
      }
    });
  } catch (err) {
    logger.error({ err }, 'updateProfile error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: err.message
    });
  }
};

/**
 * Update Key Personnel
 */
export const updateKeyPersonnel = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session' });
    }

    const {
      authorisingName, authorisingPhone, authorisingEmail, authorisingJobTitle,
      keyContactName, keyContactPhone, keyContactEmail, keyContactDepartment,
      hrName, hrPhone, hrEmail, hrJobTitle,
      level1Users
    } = req.body;

    const [profile] = await req.tenantDb.SponsorProfile.findOrCreate({
      where: { userId }
    });

    await profile.update({
      authorisingName, authorisingPhone, authorisingEmail, authorisingJobTitle,
      keyContactName, keyContactPhone, keyContactEmail, keyContactDepartment,
      hrName, hrPhone, hrEmail, hrJobTitle,
      level1Users: Array.isArray(level1Users) ? level1Users : []
    });

    const updatedProfile = await req.tenantDb.SponsorProfile.findOne({ where: { userId } });

    res.status(200).json({
      status: 'success',
      message: 'Key Personnel updated successfully',
      data: {
        profile: updatedProfile
      }
    });
  } catch (err) {
    logger.error({ err }, 'updateKeyPersonnel error');
    res.status(500).json({
      status: 'error',
      message: 'Failed to update Key Personnel',
      error: err.message
    });
  }
};

/**
 * Change Password
 */
export const changePassword = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session' });
    }

    const { current_password, new_password } = req.body || {};

    if (!new_password) {
      return res.status(400).json({ status: 'error', message: 'New password is required' });
    }

    const user = await req.tenantDb.User.findOne({ where: { id: userId } });
    
    if (user.password) {
      if (!current_password) {
        return res.status(400).json({ status: 'error', message: 'Current password is required' });
      }
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        return res.status(400).json({ status: 'error', message: 'Current password incorrect' });
      }
    }

    const hashed = await bcrypt.hash(new_password, 12);
    await req.tenantDb.User.update({ password: hashed }, { where: { id: userId } });

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully'
    });
  } catch (err) {
    logger.error({ err }, 'changePassword error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: err.message
    });
  }
};
