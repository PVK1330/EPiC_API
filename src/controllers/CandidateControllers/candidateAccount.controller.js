import db from '../../models/index.js';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { Op } from 'sequelize';

const User = db.User;
const Case = db.Case;
const CandidateAccountSettings = db.CandidateAccountSettings;
const CandidateFeedback = db.CandidateFeedback;

const ALLOWED_EXP_TAG_IDS = new Set(['easy', 'fast', 'support', 'guidance']);

/**
 * JWT `userId` is usually a number but may be a string. Some legacy DB columns
 * store fk ids as VARCHAR; comparing them to an integer param causes:
 * "operator does not exist: character varying = integer"
 */
function resolveUserIds(req) {
  const raw = req.user?.userId;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(num) || num <= 0) return null;
  return { idNum: Math.trunc(num), idStr: String(Math.trunc(num)) };
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => typeof t === 'string' && ALLOWED_EXP_TAG_IDS.has(t));
}

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

export const getAccount = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum, idStr } = ids;

    const user = await User.findOne({
      where: { id: idNum },
      attributes: excludeSensitiveUserAttrs(),
    });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found', data: null });
    }

    const [settings] = await CandidateAccountSettings.findOrCreate({
      where: { user_id: idNum },
      defaults: {
        user_id: idNum,
        notification_document_requests: true,
        notification_case_status: true,
        notification_payment_reminders: true,
        notification_deadline_alerts: false,
      },
    });

    /* "cases"."candidateId" is VARCHAR in some DBs; numeric bind caused: varchar = integer */
    const latestCase = await Case.findOne({
      where: { candidateId: idStr },
      /* Case model maps createdAt → created_at; ORDER BY must use DB column name */
      order: [['created_at', 'DESC']],
      attributes: ['id', 'caseId'],
    });

    const lastFeedback = await CandidateFeedback.findOne({
      where: { user_id: idNum },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'rating', 'experience_tags', 'comments', 'createdAt'],
    });

    res.status(200).json({
      status: 'success',
      message: 'Account loaded',
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          country_code: user.country_code,
          mobile: user.mobile,
          role_id: user.role_id,
          gender: user.gender,
          profile_pic: user.profile_pic ? `${process.env.BASE_URL}/${user.profile_pic.replace(/\\/g, '/')}` : null,
          two_factor_enabled: !!user.two_factor_enabled,
        },
        settings: {
          notification_document_requests: !!settings.notification_document_requests,
          notification_case_status: !!settings.notification_case_status,
          notification_payment_reminders: !!settings.notification_payment_reminders,
          notification_deadline_alerts: !!settings.notification_deadline_alerts,
          terms_accepted_at: settings.terms_accepted_at,
          terms_version: settings.terms_version,
          data_deletion_requested_at: settings.data_deletion_requested_at,
        },
        case: latestCase?.caseId
          ? { 
              caseId: latestCase.caseId, 
              id: latestCase.id,
              assignedStaff: await db.User.findAll({
                where: { id: { [Op.in]: Array.isArray(latestCase.assignedcaseworkerId) ? latestCase.assignedcaseworkerId.map(id => Number(id)) : [] } },
                attributes: ['id', 'first_name', 'last_name']
              })
            }
          : null,
        lastFeedback: lastFeedback
          ? {
              id: lastFeedback.id,
              rating: lastFeedback.rating,
              experience_tags: Array.isArray(lastFeedback.experience_tags)
                ? lastFeedback.experience_tags
                : [],
              comments: lastFeedback.comments || '',
              createdAt: lastFeedback.createdAt,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('getAccount error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const patchPreferences = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum } = ids;
    const body = req.body || {};

    const boolKeys = [
      'notification_document_requests',
      'notification_case_status',
      'notification_payment_reminders',
      'notification_deadline_alerts',
    ];

    const update = {};
    for (const k of boolKeys) {
      if (typeof body[k] === 'boolean') update[k] = body[k];
    }

    const [settings] = await CandidateAccountSettings.findOrCreate({
      where: { user_id: idNum },
      defaults: {
        user_id: idNum,
        notification_document_requests: true,
        notification_case_status: true,
        notification_payment_reminders: true,
        notification_deadline_alerts: false,
      },
    });

    await settings.update(update);

    res.status(200).json({
      status: 'success',
      message: 'Preferences updated',
      data: {
        settings: {
          notification_document_requests: !!settings.notification_document_requests,
          notification_case_status: !!settings.notification_case_status,
          notification_payment_reminders: !!settings.notification_payment_reminders,
          notification_deadline_alerts: !!settings.notification_deadline_alerts,
          terms_accepted_at: settings.terms_accepted_at,
          terms_version: settings.terms_version,
          data_deletion_requested_at: settings.data_deletion_requested_at,
        },
      },
    });
  } catch (err) {
    console.error('patchPreferences error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const postFeedback = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum, idStr } = ids;
    const { rating, experience_tags, comments, caseworker_id } = req.body || {};

    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({
        status: 'error',
        message: 'rating must be an integer between 1 and 5',
        data: null,
      });
    }

    const tags = sanitizeTags(experience_tags);
    const text = typeof comments === 'string' ? comments.trim().slice(0, 8000) : '';

    // Find latest case to link feedback to caseworker/admin
    const latestCase = await Case.findOne({
      where: { candidateId: idStr },
      order: [['created_at', 'DESC']],
      attributes: ['id']
    });

    const row = await CandidateFeedback.create({
      user_id: idNum,
      rating: r,
      experience_tags: tags,
      comments: text || null,
      case_id: latestCase?.id || null,
      caseworker_id: caseworker_id ? Number(caseworker_id) : null,
    });

    res.status(201).json({
      status: 'success',
      message: 'Feedback submitted',
      data: {
        feedback: {
          id: row.id,
          rating: row.rating,
          experience_tags: row.experience_tags,
          comments: row.comments || '',
          createdAt: row.createdAt,
        },
      },
    });
  } catch (err) {
    console.error('postFeedback error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const postConsent = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum } = ids;
    const terms_version = typeof req.body?.terms_version === 'string'
      ? req.body.terms_version.trim().slice(0, 64)
      : null;

    const [settings] = await CandidateAccountSettings.findOrCreate({
      where: { user_id: idNum },
      defaults: {
        user_id: idNum,
        notification_document_requests: true,
        notification_case_status: true,
        notification_payment_reminders: true,
        notification_deadline_alerts: false,
      },
    });

    await settings.update({
      terms_accepted_at: new Date(),
      terms_version: terms_version || settings.terms_version || 'current',
    });

    await settings.reload();

    res.status(200).json({
      status: 'success',
      message: 'Consent recorded',
      data: {
        settings: {
          terms_accepted_at: settings.terms_accepted_at,
          terms_version: settings.terms_version,
        },
      },
    });
  } catch (err) {
    console.error('postConsent error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const postDataDeletionRequest = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum } = ids;

    const [settings] = await CandidateAccountSettings.findOrCreate({
      where: { user_id: idNum },
      defaults: {
        user_id: idNum,
        notification_document_requests: true,
        notification_case_status: true,
        notification_payment_reminders: true,
        notification_deadline_alerts: false,
      },
    });

    if (settings.data_deletion_requested_at) {
      return res.status(200).json({
        status: 'success',
        message: 'A data deletion request was already recorded.',
        data: {
          data_deletion_requested_at: settings.data_deletion_requested_at,
        },
      });
    }

    await settings.update({ data_deletion_requested_at: new Date() });
    await settings.reload();

    res.status(200).json({
      status: 'success',
      message: 'Data deletion request submitted. Our team will contact you.',
      data: {
        data_deletion_requested_at: settings.data_deletion_requested_at,
      },
    });
  } catch (err) {
    console.error('postDataDeletionRequest error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

/**
 * Update candidate profile information
 */
export const updateProfile = async (req, res) => {
  console.log('updateProfile request received', {
    body: req.body,
    file: req.file ? req.file.originalname : 'no file',
    user: req.user
  });
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum } = ids;
    
    const body = req.body || {};
    const { first_name, last_name, country_code, mobile, gender } = body;

    const user = await User.findOne({ where: { id: idNum } });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found', data: null });
    }

    // Validate required fields
    if (!first_name || !last_name) {
      return res.status(400).json({
        status: 'error',
        message: 'First name and last name are required',
        data: null
      });
    }

    // Mobile uniqueness check
    if (mobile && country_code) {
      const mobileExists = await User.findOne({
        where: { 
          country_code, 
          mobile,
          id: { [Op.ne]: idNum }
        }
      });
      if (mobileExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Mobile number already exists',
          data: null
        });
      }
    }

    const updateData = {
      first_name: first_name || user.first_name,
      last_name: last_name || user.last_name,
      country_code: country_code || user.country_code,
      mobile: mobile || user.mobile,
      gender: gender || user.gender,
    };

    // Handle profile pic if uploaded
    if (req.file) {
      console.log('File detected in request:', req.file.originalname);
      const userDir = path.join('uploads', 'profile_pics', String(idNum));
      if (!fs.existsSync(userDir)) {
        console.log('Creating user directory:', userDir);
        fs.mkdirSync(userDir, { recursive: true });
      }
      const targetPath = path.join(userDir, req.file.filename);
      console.log('Moving file from', req.file.path, 'to', targetPath);
      fs.renameSync(req.file.path, targetPath);
      updateData.profile_pic = targetPath.replace(/\\/g, '/');
      console.log('Profile pic updated in data:', updateData.profile_pic);
    } else {
      console.log('No file detected in req.file');
    }

    await user.update(updateData);

    // Reload with role info for the response
    const updatedUser = await User.findOne({
      where: { id: idNum },
      attributes: excludeSensitiveUserAttrs(),
      include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }]
    });

    if (updatedUser.profile_pic) {
      const normalizedPath = updatedUser.profile_pic.replace(/\\/g, '/');
      updatedUser.profile_pic = `${process.env.BASE_URL}/${normalizedPath}`;
    }

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: { user: updatedUser }
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message
    });
  }
};

/**
 * Change own password
 */
export const changePassword = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum } = ids;
    const { current_password, new_password } = req.body || {};

    if (!new_password) {
      return res.status(400).json({ status: 'error', message: 'New password is required', data: null });
    }

    const user = await User.findOne({ where: { id: idNum } });
    
    // If user has a password set, require and verify the old one
    if (user.password) {
      if (!current_password) {
        return res.status(400).json({ status: 'error', message: 'Current password is required to set a new one', data: null });
      }
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        return res.status(400).json({ status: 'error', message: 'Current password incorrect', data: null });
      }
    }

    const hashed = await bcrypt.hash(new_password, 12);
    await user.update({ password: hashed });

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully'
    });
  } catch (err) {
    console.error('changePassword error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message
    });
  }
};
