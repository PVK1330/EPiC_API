import db from '../../models/index.js';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { Op } from 'sequelize';
import {
  createBulkNotifications,
  NotificationTypes,
  NotificationPriority,
} from '../../services/notification.service.js';

const User = db.User;
const Case = db.Case;
const CandidateAccountSettings = db.CandidateAccountSettings;
const CandidateFeedback = db.CandidateFeedback;
const CandidateIssueReport = db.CandidateIssueReport;

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

/** Allowed issue categories (ITSM-style intake). */
export const ISSUE_CATEGORY_IDS = [
  'portal_access',
  'documents_uploads',
  'payments_billing',
  'case_status',
  'communication',
  'appointments',
  'account_profile',
  'technical_bug',
  'privacy_security',
  'other',
];

const ISSUE_SEVERITY_IDS = ['low', 'medium', 'high', 'urgent'];

function normalizeCaseworkerIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j)
        ? j.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function notifyStakeholdersOfIssueReport({
  reportId,
  candidateId,
  candidateName,
  caseRef,
  category,
  severity,
  subject,
  caseworkerIds,
}) {
  const title = `Issue report: ${subject}`;
  const message = `${candidateName} submitted a ${severity} severity report (${category.replace(/_/g, ' ')}).${caseRef ? ` Case reference: ${caseRef}.` : ''}`;
  const recipientIds = new Set();
  caseworkerIds.forEach((id) => recipientIds.add(id));

  const adminRole = await db.Role.findOne({
    where: { name: { [Op.iLike]: 'admin' } },
  });
  if (adminRole) {
    const admins = await User.findAll({
      where: { role_id: adminRole.id, status: 'active' },
      attributes: ['id'],
    });
    admins.forEach((a) => recipientIds.add(a.id));
  }

  const ids = [...recipientIds];
  if (!ids.length) return;

  const priority =
    severity === 'urgent'
      ? NotificationPriority.URGENT
      : severity === 'high'
        ? NotificationPriority.HIGH
        : NotificationPriority.MEDIUM;

  await createBulkNotifications(ids, {
    type: NotificationTypes.CANDIDATE_ISSUE_REPORT,
    priority,
    title,
    message,
    entityId: reportId,
    entityType: 'candidate_issue_report',
    metadata: {
      reportId,
      candidateId,
      category,
      severity,
      caseRef,
      subject,
    },
    sendEmail: true,
  });
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
      order: [['created_at', 'DESC']],
      attributes: ['id', 'caseId', 'assignedcaseworkerId'],
    });

    const cwIds = normalizeCaseworkerIds(latestCase?.assignedcaseworkerId);
    const assignedStaff =
      cwIds.length > 0
        ? await User.findAll({
            where: { id: { [Op.in]: cwIds } },
            attributes: ['id', 'first_name', 'last_name'],
          })
        : [];

    const casePayload = latestCase?.caseId
      ? {
          caseId: latestCase.caseId,
          id: latestCase.id,
          assignedStaff,
        }
      : null;

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
        case: casePayload,
        feedbackSubmitted: !!lastFeedback,
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

    const existing = await CandidateFeedback.findOne({ where: { user_id: idNum } });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        message:
          'You have already submitted feedback. Each candidate may submit feedback only once.',
        data: {
          feedback: {
            id: existing.id,
            rating: existing.rating,
            experience_tags: Array.isArray(existing.experience_tags)
              ? existing.experience_tags
              : [],
            comments: existing.comments || '',
            createdAt: existing.createdAt,
          },
        },
      });
    }

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
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        status: 'error',
        message:
          'You have already submitted feedback. Each candidate may submit feedback only once.',
        data: null,
      });
    }
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
 * Submit structured issue report with optional screenshots (multipart field `attachments`).
 * Notifies assigned caseworkers on the candidate's latest case and all active admins.
 */
export const postIssueReport = async (req, res) => {
  try {
    const ids = resolveUserIds(req);
    if (!ids) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }
    const { idNum, idStr } = ids;

    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const severityRaw = typeof req.body?.severity === 'string' ? req.body.severity.trim().toLowerCase() : 'medium';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim().slice(0, 255) : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 12000) : '';

    if (!ISSUE_CATEGORY_IDS.includes(category)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid issue category.',
        data: null,
      });
    }
    if (!ISSUE_SEVERITY_IDS.includes(severityRaw)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid severity. Use low, medium, high, or urgent.',
        data: null,
      });
    }
    if (!subject || subject.length < 3) {
      return res.status(400).json({
        status: 'error',
        message: 'Subject is required (at least 3 characters).',
        data: null,
      });
    }
    if (!description || description.length < 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Please describe the issue in at least 10 characters.',
        data: null,
      });
    }

    const latestCase = await Case.findOne({
      where: { candidateId: idStr },
      order: [['created_at', 'DESC']],
      attributes: ['id', 'caseId', 'assignedcaseworkerId'],
    });

    let effectiveCaseId = latestCase?.id ?? null;
    if (
      req.body?.case_id !== undefined &&
      req.body?.case_id !== null &&
      String(req.body.case_id).trim() !== ''
    ) {
      const cid = Number(req.body.case_id);
      if (!Number.isFinite(cid)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid case reference.',
          data: null,
        });
      }
      const ownsCase = await Case.findOne({
        where: { id: cid, candidateId: idStr },
        attributes: ['id'],
      });
      if (!ownsCase) {
        return res.status(403).json({
          status: 'error',
          message: 'Invalid case reference for your account.',
          data: null,
        });
      }
      effectiveCaseId = cid;
    }

    const destRoot = path.join('uploads', 'candidate_reports', String(idNum));
    fs.mkdirSync(destRoot, { recursive: true });

    const attachmentUrls = [];
    const files = req.files || [];
    for (const f of files) {
      try {
        const dest = path.join(destRoot, f.filename);
        if (f.path && fs.existsSync(f.path)) {
          fs.renameSync(f.path, dest);
        }
        const rel = dest.replace(/\\/g, '/');
        const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
        attachmentUrls.push(`${baseUrl}/${rel}`);
      } catch (e) {
        console.error('postIssueReport file move error:', e);
      }
    }

    const reporter = await User.findByPk(idNum, {
      attributes: ['id', 'first_name', 'last_name', 'email'],
    });
    const candidateName =
      [reporter?.first_name, reporter?.last_name].filter(Boolean).join(' ') ||
      reporter?.email ||
      'Candidate';

    const row = await CandidateIssueReport.create({
      user_id: idNum,
      case_id: effectiveCaseId,
      category,
      severity: severityRaw,
      subject,
      description,
      attachment_urls: attachmentUrls,
      status: 'open',
    });

    const cwIds = normalizeCaseworkerIds(latestCase?.assignedcaseworkerId);

    await notifyStakeholdersOfIssueReport({
      reportId: row.id,
      candidateId: idNum,
      candidateName,
      caseRef: latestCase?.caseId || null,
      category,
      severity: severityRaw,
      subject,
      caseworkerIds: cwIds,
    });

    res.status(201).json({
      status: 'success',
      message: 'Your report has been submitted. A caseworker or administrator will review it shortly.',
      data: {
        report: {
          id: row.id,
          category: row.category,
          severity: row.severity,
          subject: row.subject,
          status: row.status,
          attachment_urls: row.attachment_urls,
          createdAt: row.createdAt,
        },
      },
    });
  } catch (err) {
    console.error('postIssueReport error:', err);
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
