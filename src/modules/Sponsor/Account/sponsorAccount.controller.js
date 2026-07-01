import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { Op } from 'sequelize';

import logger from '../../../utils/logger.js';
import { toPublicImagePath } from '../../../utils/storagePath.util.js';
import platformDb from '../../../models/index.js';
import { excludeSensitiveUserAttrs } from '../../../utils/userAttributes.js';

const ALLOWED_PROFILE_DOC_FIELDS = new Set([
  'sponsorLetter',
  'insuranceCertificate',
  'hrPolicies',
  'organisationalChart',
  'recruitmentDocs',
]);
const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'private');
// Registration documents are MOVED here by updateProfile (multer temp ->
// uploads/sponsor_docs/<userId>/...), so the stored path lives under this tree,
// NOT storage/private. Both are allowed for download so legacy + new files work.
const SPONSOR_DOCS_DIR = path.resolve(process.cwd(), 'uploads', 'sponsor_docs');
const ALLOWED_DOWNLOAD_DIRS = [PRIVATE_STORAGE_DIR, SPONSOR_DOCS_DIR];
const INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']);

// Fields with strict shapes. Validated server-side so bad input from ANY of the
// profile modals returns a clean 400 instead of a Sequelize 500 (e.g. an email
// pasted into a phone field overflowing the column).
const PROFILE_EMAIL_FIELDS = ['authorisingEmail', 'keyContactEmail', 'hrEmail', 'billingEmail'];
const PROFILE_PHONE_FIELDS = ['authorisingPhone', 'keyContactPhone', 'hrPhone', 'billingPhone'];
const PHONE_MAX_LEN = 30; // matches the widened VARCHAR(30) columns
const EMAIL_MAX_LEN = 255; // matches the VARCHAR(255) email columns
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone: +, digits, spaces, parentheses, hyphens, dots — 5 to 30 chars.
const PHONE_RE = /^[+()\-.\s\d]{5,30}$/;

/**
 * Validate + normalise the subset of sponsor-profile fields that have strict
 * shapes (emails, phones, numbers, dates). Only fields actually PRESENT in the
 * body are checked, so partial updates from the per-section modals stay valid.
 *
 * @returns {{ errors: Record<string,string>, normalised: Record<string,any> }}
 *          `errors` is field→message (empty when valid); `normalised` holds the
 *          cleaned/coerced values to persist (numbers as numbers, trimmed text).
 */
function validateSponsorProfileInput(body = {}) {
  const errors = {};
  const normalised = {};
  const has = (k) =>
    body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '';

  for (const f of PROFILE_EMAIL_FIELDS) {
    if (!has(f)) continue;
    const v = String(body[f]).trim();
    if (!EMAIL_RE.test(v)) errors[f] = 'Enter a valid email address';
    else if (v.length > EMAIL_MAX_LEN) errors[f] = `Email address must be ${EMAIL_MAX_LEN} characters or fewer`;
    else normalised[f] = v;
  }

  for (const f of PROFILE_PHONE_FIELDS) {
    if (!has(f)) continue;
    const v = String(body[f]).trim();
    if (v.includes('@')) errors[f] = 'Phone number cannot be an email address';
    else if (!PHONE_RE.test(v)) errors[f] = 'Enter a valid phone number';
    else if (v.length > PHONE_MAX_LEN) errors[f] = `Phone number must be ${PHONE_MAX_LEN} characters or fewer`;
    else normalised[f] = v;
  }

  if (has('yearEstablished')) {
    const n = Number(body.yearEstablished);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(n) || n < 1800 || n > currentYear) {
      errors.yearEstablished = `Enter a valid year between 1800 and ${currentYear}`;
    } else {
      normalised.yearEstablished = n;
    }
  }

  if (has('cosAllocation')) {
    const n = Number(body.cosAllocation);
    if (!Number.isInteger(n) || n < 0) errors.cosAllocation = 'CoS allocation must be a whole number';
    else normalised.cosAllocation = n;
  }

  if (has('outstandingBalance')) {
    const n = Number(body.outstandingBalance);
    if (Number.isNaN(n) || n < 0) errors.outstandingBalance = 'Outstanding balance must be a number';
    else normalised.outstandingBalance = n;
  }

  if (has('licenceIssueDate') && has('licenceExpiryDate')) {
    const issue = new Date(body.licenceIssueDate);
    const expiry = new Date(body.licenceExpiryDate);
    if (!Number.isNaN(issue.getTime()) && !Number.isNaN(expiry.getTime()) && expiry < issue) {
      errors.licenceExpiryDate = 'Licence expiry date cannot be before the issue date';
    }
  }

  return { errors, normalised };
}

/**
 * Map a Sequelize/Postgres data error to a clean 400 (instead of a 500) when the
 * payload was simply malformed/too long. Returns true if it handled the response.
 */
function handleProfileDbError(err, res) {
  const msg = String(err?.message || '');
  // Match only genuinely user-correctable data errors. We deliberately do NOT
  // match the broad 'SequelizeDatabaseError' name — that also wraps schema drift
  // (missing column), constraint faults, deadlocks, etc., which must stay 500s so
  // they surface in logs/alerts rather than masquerading as "bad input".
  if (
    err?.name === 'SequelizeValidationError' ||
    /value too long|invalid input syntax|out of range|numeric field overflow/i.test(msg)
  ) {
    res.status(400).json({
      status: 'error',
      message: 'One or more fields are invalid or too long. Please review your input and try again.',
      error: msg,
    });
    return true;
  }
  return false;
}

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

    // Field-level validation (emails, phones, year, numbers, licence dates).
    // Returns a clean 400 before we ever touch the DB.
    const { errors: fieldErrors, normalised } = validateSponsorProfileInput(req.body);
    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Please correct the highlighted fields and try again.',
        errors: fieldErrors,
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
        // Prefer the validated/coerced value (numbers as numbers, trimmed text)
        // when validation produced one for this field.
        let value = Object.prototype.hasOwnProperty.call(normalised, field)
          ? normalised[field]
          : req.body[field];

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
    if (handleProfileDbError(err, res)) return;
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

    const { errors: fieldErrors, normalised } = validateSponsorProfileInput(req.body);
    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Please correct the highlighted fields and try again.',
        errors: fieldErrors,
      });
    }

    const [profile] = await req.tenantDb.SponsorProfile.findOrCreate({
      where: { userId }
    });

    // Treat a cleared field ("") as NULL, mirroring updateProfile, so both
    // endpoints store consistent values for the same columns.
    const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
    await profile.update({
      authorisingName: blankToNull(authorisingName),
      authorisingPhone: blankToNull(authorisingPhone),
      authorisingEmail: blankToNull(authorisingEmail),
      authorisingJobTitle: blankToNull(authorisingJobTitle),
      keyContactName: blankToNull(keyContactName),
      keyContactPhone: blankToNull(keyContactPhone),
      keyContactEmail: blankToNull(keyContactEmail),
      keyContactDepartment: blankToNull(keyContactDepartment),
      hrName: blankToNull(hrName),
      hrPhone: blankToNull(hrPhone),
      hrEmail: blankToNull(hrEmail),
      hrJobTitle: blankToNull(hrJobTitle),
      level1Users: Array.isArray(level1Users) ? level1Users : [],
      // Validated/normalised emails & phones override the raw destructured values.
      ...normalised,
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
    if (handleProfileDbError(err, res)) return;
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

    // Passwords live in the platform DB (same DB that login checks against).
    const user = await platformDb.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

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
    await platformDb.User.update({ password: hashed, password_changed_at: new Date() }, { where: { id: userId } });

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

export const downloadProfileDocument = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorised' });

    const { field } = req.params;
    if (!ALLOWED_PROFILE_DOC_FIELDS.has(field)) {
      return res.status(400).json({ status: 'error', message: 'Invalid document field' });
    }

    const profile = await req.tenantDb.SponsorProfile.findOne({ where: { userId } });
    const filePath = profile?.[field];
    if (!filePath) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    const absolute = path.resolve(String(filePath));
    // Allow files within either approved tree; the prefix check (dir + sep) keeps
    // a crafted "../" path from escaping the allowed roots.
    const isAllowed = ALLOWED_DOWNLOAD_DIRS.some(
      (dir) => absolute === dir || absolute.startsWith(dir + path.sep)
    );
    if (!isAllowed) {
      return res.status(400).json({ status: 'error', message: 'Invalid path' });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ status: 'error', message: 'File no longer exists' });
    }

    const filename = path.basename(absolute);
    const ext = path.extname(filename).toLowerCase();
    const disposition = INLINE_EXTENSIONS.has(ext) ? 'inline' : 'attachment';

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    return res.sendFile(absolute, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ status: 'error', message: 'Error streaming file' });
      }
    });
  } catch (err) {
    logger.error({ err }, 'downloadProfileDocument error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
