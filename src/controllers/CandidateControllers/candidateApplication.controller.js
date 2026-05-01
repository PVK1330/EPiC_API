import path from 'path';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import db from '../../models/index.js';
import { notifyCaseCreated } from '../../services/notification.service.js';
import { addTimelineEntry } from '../../services/timeline.service.js';
import { streamBrandedPdf } from '../../services/pdfGenerator.service.js';
import { rowsToXlsxBuffer, xlsxBufferToRows } from '../../utils/excelExport.util.js';
import { generateStrongPassword } from '../../utils/passwordGenerator.js';

const CandidateApplication = db.CandidateApplication;

/**
 * Every form field that a candidate can save / submit.
 * Matches the fields defined in candidateApplication.model.js exactly.
 */
const APPLICATION_FIELDS = [
  // Core identity (mirrors users table for self-contained records)
  'firstName', 'lastName', 'email', 'contactNumber',

  // Personal
  'applicationType', 'gender', 'relationshipStatus', 'address', 'contactNumber2',
  'previousFullAddress', 'previousAddress', 'startDate', 'endDate',

  // Nationality & Passport
  'nationality', 'birthCountry', 'placeOfBirth', 'dob',
  'passportNumber', 'issuingAuthority', 'issueDate', 'expiryDate', 'passportAvailable',

  // Identity documents
  'nationalIdCardNumber', 'nationalIdNumber',
  'idIssuingAuthorityCard', 'idIssuingAuthorityNational',
  'otherNationality', 'ukLicense', 'medicalTreatment', 'ukStayDuration',

  // Parent one
  'parentName', 'parentRelation', 'parentDob', 'parentNationality', 'sameNationality',

  // Parent two
  'parent2Name', 'parent2Relation', 'parent2Dob', 'parent2Nationality', 'parent2SameNationality',

  // Immigration history
  'illegalEntry', 'overstayed', 'breach', 'falseInfo', 'otherBreach',
  'refusedVisa', 'refusedEntry', 'refusedPermission', 'refusedAsylum',
  'deported', 'removed', 'requiredToLeave', 'banned',

  // Travel history
  'visitedOther', 'countryVisited', 'visitReason', 'entryDate', 'leaveDate',

  // Current visa status & English language
  'visaType', 'brpNumber', 'visaEndDate', 'niNumber', 'sponsored', 'englishProof',

  // Admin-defined custom questions
  'customResponses',
];

function resolveUserId(req) {
  const raw = req.user?.userId;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

const generateCaseId = async () => {
  const lastCase = await db.Case.findOne({
    order: [["created_at", "DESC"]],
  });

  let nextId = 1;
  if (lastCase && lastCase.caseId) {
    const parts = lastCase.caseId.split("-");
    if (parts.length === 2 && !isNaN(parseInt(parts[1], 10))) {
      nextId = parseInt(parts[1], 10) + 1;
    } else {
      const count = await db.Case.count();
      nextId = count + 1;
    }
  }

  return `CAS-${String(nextId).padStart(6, "0")}`;
};

/** Every field that maps to a DATE / TIMESTAMPTZ column in the model. */
const DATE_FIELDS = new Set([
  'dob', 'issueDate', 'expiryDate',
  'startDate', 'endDate',
  'parentDob', 'parent2Dob',
  'entryDate', 'leaveDate',
  'visaEndDate',
]);

/**
 * Every field that maps to a PostgreSQL ENUM column.
 * PostgreSQL rejects "" for ENUM — it must be a valid enum value or NULL.
 */
const ENUM_FIELDS = new Set([
  'applicationType',
  'passportAvailable',
  'ukLicense',
  'medicalTreatment',
  'sameNationality',
  'parent2SameNationality',
  'illegalEntry',
  'overstayed',
  'breach',
  'falseInfo',
  'otherBreach',
  'refusedVisa',
  'refusedEntry',
  'refusedPermission',
  'refusedAsylum',
  'deported',
  'removed',
  'requiredToLeave',
  'banned',
  'visitedOther',
  'sponsored',
  'englishProof',
]);

/**
 * Pick only permitted fields from the request body and sanitize:
 *  - DATE fields   : "" or unparseable strings → null
 *  - ENUM fields   : "" (or any string not in the allowed set) → null
 */
function pickFields(body) {
  const payload = {};
  for (const key of APPLICATION_FIELDS) {
    if (body[key] === undefined) continue;

    const v = body[key];

    if (DATE_FIELDS.has(key)) {
      if (!v || typeof v !== 'string' || v.trim() === '') {
        payload[key] = null;
      } else {
        const parsed = new Date(v);
        payload[key] = isNaN(parsed.getTime()) ? null : parsed;
      }
    } else if (ENUM_FIELDS.has(key)) {
      payload[key] = (v === null || v === undefined || String(v).trim() === '')
        ? null
        : v;
    } else {
      payload[key] = v;
    }
  }
  return payload;
}

// ── Section definitions used for completeness scoring ────────────────────────
const PDF_APPLICATION_SECTIONS = [
  {
    title: 'Personal Information',
    fields: [
      'firstName', 'lastName', 'email', 'contactNumber', 'contactNumber2',
      'applicationType', 'gender', 'relationshipStatus', 'address',
      'previousFullAddress', 'previousAddress', 'startDate', 'endDate',
    ],
  },
  {
    title: 'Nationality & Birth',
    fields: ['nationality', 'birthCountry', 'placeOfBirth', 'dob'],
  },
  {
    title: 'Passport & Travel Document',
    fields: [
      'passportNumber', 'issuingAuthority', 'issueDate', 'expiryDate',
      'passportAvailable',
    ],
  },
  {
    title: 'Identity & Residence',
    fields: [
      'nationalIdCardNumber', 'nationalIdNumber',
      'idIssuingAuthorityCard', 'idIssuingAuthorityNational',
      'otherNationality', 'ukLicense', 'medicalTreatment', 'ukStayDuration',
    ],
  },
  {
    title: 'Parent or Legal Guardian (First)',
    fields: [
      'parentName', 'parentRelation', 'parentDob', 'parentNationality',
      'sameNationality',
    ],
  },
  {
    title: 'Parent or Legal Guardian (Second)',
    fields: [
      'parent2Name', 'parent2Relation', 'parent2Dob', 'parent2Nationality',
      'parent2SameNationality',
    ],
  },
  {
    title: 'Immigration History',
    fields: [
      'illegalEntry', 'overstayed', 'breach', 'falseInfo', 'otherBreach',
      'refusedVisa', 'refusedEntry', 'refusedPermission', 'refusedAsylum',
      'deported', 'removed', 'requiredToLeave', 'banned',
    ],
  },
  {
    title: 'Travel History',
    fields: [
      'visitedOther', 'countryVisited', 'visitReason', 'entryDate', 'leaveDate',
    ],
  },
  {
    title: 'Current Visa Status & English Language',
    fields: [
      'visaType', 'brpNumber', 'visaEndDate', 'niNumber', 'sponsored',
      'englishProof',
    ],
  },
];

const COMPLETION_SECTIONS = [
  {
    key: 'personal',
    label: 'Personal Information',
    fields: ['firstName', 'lastName', 'email', 'contactNumber', 'gender',
             'relationshipStatus', 'address', 'dob', 'applicationType'],
  },
  {
    key: 'identity',
    label: 'Identity & Passport',
    fields: ['nationality', 'birthCountry', 'placeOfBirth', 'passportNumber',
             'issuingAuthority', 'issueDate', 'expiryDate', 'passportAvailable'],
  },
  {
    key: 'immigration',
    label: 'Immigration History',
    fields: ['illegalEntry', 'overstayed', 'breach', 'falseInfo', 'otherBreach',
             'refusedVisa', 'refusedEntry', 'refusedPermission', 'refusedAsylum',
             'deported', 'removed', 'requiredToLeave', 'banned'],
  },
  {
    key: 'visa',
    label: 'Current Visa & Employment',
    fields: ['visaType', 'brpNumber', 'visaEndDate', 'niNumber', 'sponsored', 'englishProof'],
  },
  {
    key: 'parents',
    label: 'Parent Information',
    fields: ['parentName', 'parentRelation', 'parentDob', 'parentNationality'],
  },
];

/**
 * Compute completeness scores from a plain application object.
 * @param {object} app - application.toJSON()
 * @param {object[]} documents - uploaded document records
 * @param {object[]} documentSettings - required-field settings (field_type = 'file')
 */
function computeCompletionScore(app, documents, documentSettings) {
  const sectionScores = COMPLETION_SECTIONS.map(section => {
    const filled = section.fields.filter(f => {
      const val = app[f];
      return val !== null && val !== undefined && val !== '';
    }).length;
    const pct = section.fields.length > 0
      ? Math.round((filled / section.fields.length) * 100)
      : 0;
    return {
      key: section.key,
      label: section.label,
      filled,
      total: section.fields.length,
      pct,
      complete: filled === section.fields.length,
    };
  });

  const totalFields = COMPLETION_SECTIONS.reduce((sum, s) => sum + s.fields.length, 0);
  const totalFilled = sectionScores.reduce((sum, s) => sum + s.filled, 0);
  const overallPct = totalFields > 0 ? Math.round((totalFilled / totalFields) * 100) : 0;

  // Document completeness
  const requiredDocs = documentSettings.filter(s => s.is_required);
  const uploadedRequiredDocs = requiredDocs.filter(s =>
    documents.some(d =>
      d.documentType === s.field_key && ['uploaded', 'approved'].includes(d.status)
    )
  );
  const docPct = requiredDocs.length > 0
    ? Math.round((uploadedRequiredDocs.length / requiredDocs.length) * 100)
    : 100;

  return {
    overall: overallPct,
    isComplete: overallPct === 100 && docPct === 100,
    sections: sectionScores,
    documents: {
      required: requiredDocs.length,
      uploaded: uploadedRequiredDocs.length,
      pct: docPct,
    },
  };
}

export const getCandidateApplicationFieldSettings = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const settings = await db.ApplicationFieldSetting.findAll({
      where: { field_type: { [Op.ne]: 'file' } },
      attributes: ['id', 'field_key', 'field_label', 'is_visible', 'field_order', 'field_type'],
      order: [['field_order', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      message: 'Field settings loaded',
      data: settings.map((s) => s.toJSON()),
    });
  } catch (err) {
    console.error('getCandidateApplicationFieldSettings error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const getCandidateApplicationCustomFields = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const customFields = await db.ApplicationCustomField.findAll({
      where: { is_active: true },
      order: [['display_order', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      message: 'Custom fields loaded',
      data: customFields.map((f) => f.toJSON()),
    });
  } catch (err) {
    console.error('getCandidateApplicationCustomFields error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

/** GET /api/candidate/application — load the logged-in candidate's application */
export const getMyApplication = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const application = await CandidateApplication.findOne({
      where: { userId },
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email'],
        },
      ],
    });

    const relatedData = {
      cases: [],
      documents: [],
      documentSettings: [],
      completionScore: null,
    };

    if (application) {
      // Fetch cases with timeline
      const cases = await db.Case.findAll({
        where: { candidateId: userId },
        include: [
          {
            model: db.VisaType,
            as: 'visaType',
            attributes: ['id', 'name'],
          },
          {
            model: db.CaseTimeline,
            as: 'timeline',
            where: { visibility: 'public' },
            required: false,
            order: [['actionDate', 'DESC']],
          },
        ],
        order: [['created_at', 'DESC']],
      });

      // Fetch all documents belonging to this user
      const documents = await db.Document.findAll({
        where: { userId },
        order: [['created_at', 'DESC']],
      });

      // Fetch admin-configured required document types
      const documentSettings = await db.ApplicationFieldSetting.findAll({
        where: { field_type: 'file', is_visible: true },
        attributes: ['id', 'field_key', 'field_label', 'is_required'],
      });

      const completionScore = computeCompletionScore(
        application.toJSON(),
        documents,
        documentSettings
      );

      relatedData.cases = cases;
      relatedData.documents = documents;
      relatedData.documentSettings = documentSettings;
      relatedData.completionScore = completionScore;
    }

    res.status(200).json({
      status: 'success',
      message: 'Application loaded',
      data: {
        application: application
          ? { ...application.toJSON(), _relatedData: relatedData }
          : null,
      },
    });
  } catch (err) {
    console.error('getMyApplication error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

/** POST /api/candidate/application — submit the application (creates or updates, marks as submitted) */
export const submitApplication = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    // Guard: reject if the application has already been submitted
    const alreadySubmitted = await CandidateApplication.findOne({ where: { userId } });
    if (alreadySubmitted && alreadySubmitted.status === 'submitted') {
      return res.status(409).json({
        success: false,
        message: 'Your application has already been submitted and is currently under review.',
      });
    }

    const payload = pickFields(req.body || {});

    const application = await db.sequelize.transaction(async (t) => {
      const existing = await CandidateApplication.findOne({
        where: { userId },
        transaction: t,
      });

      let app;
      if (existing) {
        await existing.update({
          ...payload,
          status: 'submitted',
          isLocked: true,
          submittedAt: new Date(),
        }, { transaction: t });
        await existing.reload({ transaction: t });
        app = existing;
      } else {
        app = await CandidateApplication.create({
          userId,
          ...payload,
          status: 'submitted',
          isLocked: true,
          submittedAt: new Date(),
        }, { transaction: t });
      }

      // ── Handle Case creation/update ─────────────────────────────────────
      let visaTypeId = null;
      if (payload.visaType) {
        const vt = await db.VisaType.findOne({
          where: { name: { [db.Sequelize.Op.iLike]: `%${payload.visaType}%` } },
          transaction: t,
        });
        if (vt) visaTypeId = vt.id;
      }

      const caseworkerId = req.body.caseworkerId;
      const assignedcaseworkerId = caseworkerId ? [Number(caseworkerId)] : null;

      const existingCase = await db.Case.findOne({
        where: { candidateId: userId },
        transaction: t,
      });

      if (existingCase) {
        await existingCase.update(
          {
            visaTypeId: visaTypeId || existingCase.visaTypeId,
            nationality: app.nationality || existingCase.nationality,
            assignedcaseworkerId: assignedcaseworkerId || existingCase.assignedcaseworkerId,
            status: 'Lead',
          },
          { transaction: t }
        );
      } else {
        const caseIdStr = await generateCaseId();
        const caseRecord = await db.Case.create(
          {
            caseId: caseIdStr,
            candidateId: userId,
            visaTypeId,
            status: 'Lead',
            priority: 'medium',
            targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            nationality: app.nationality || null,
            jobTitle: 'Candidate',
            totalAmount: 0,
            paidAmount: 0,
            assignedcaseworkerId,
          },
          { transaction: t }
        );

        await notifyCaseCreated({
          id: caseRecord.id,
          caseId: caseRecord.caseId,
          candidateName: `${app.firstName} ${app.lastName}`,
        });

        await addTimelineEntry({
          caseId: caseRecord.id,
          actionType: 'case_created',
          description: `Case ${caseRecord.caseId} created for ${app.firstName} ${app.lastName}`,
          performedBy: userId,
          visibility: 'public',
        });
      }

      const targetCase =
        existingCase ||
        (await db.Case.findOne({ where: { candidateId: userId }, transaction: t }));

      if (targetCase) {
        // Link any orphaned documents uploaded by this user to this case
        await db.Document.update(
          { caseId: targetCase.id },
          { 
            where: { userId, caseId: null },
            transaction: t 
          }
        );

        await addTimelineEntry({
          caseId: targetCase.id,
          actionType: 'status_changed',
          description: `Application submitted by ${app.firstName} ${app.lastName}`,
          performedBy: userId,
          visibility: 'public',
          newValue: 'Lead',
        });
      }

      return app;
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully.',
      data: { application },
    });
  } catch (err) {
    console.error('submitApplication error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

/** PUT /api/candidate/application — save a draft without changing submission status */
export const saveDraft = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const existing = await CandidateApplication.findOne({ where: { userId } });

    // Guard: locked applications cannot be edited
    if (existing && existing.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Your application is locked and cannot be edited. Contact your caseworker.',
      });
    }

    const payload = pickFields(req.body || {});

    let application;
    if (existing) {
      await existing.update(payload);
      await existing.reload();
      application = existing;
    } else {
      application = await CandidateApplication.create({
        userId,
        ...payload,
        status: 'draft',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Draft saved.',
      data: { application },
    });
  } catch (err) {
    console.error('saveDraft error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const unlockApplication = async (req, res) => {
  try {
    const candidateId = Number(req.params.candidateId);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid candidateId.' });
    }

    const application = await CandidateApplication.findOne({ where: { userId: candidateId } });
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    application.isLocked = false;
    await application.save();

    res.status(200).json({ success: true, message: 'Application unlocked successfully.' });
  } catch (err) {
    console.error('unlockApplication error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

export const adminUpdateCandidateApplication = async (req, res) => {
  try {
    const candidateId = Number(req.params.id);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid candidate id', data: null });
    }

    const candidate = await db.User.findOne({ where: { id: candidateId, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({ status: 'error', message: 'Candidate not found', data: null });
    }

    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
    } = req.body;

    const payload = pickFields(req.body || {});

    if (email !== undefined && email !== candidate.email) {
      const existingEmail = await db.User.findOne({
        where: { email, id: { [Op.ne]: candidateId } },
      });
      if (existingEmail) {
        return res.status(400).json({ status: 'error', message: 'Email already exists', data: null });
      }
    }

    const nextCc = country_code !== undefined ? country_code : candidate.country_code;
    const nextMob = mobile !== undefined ? mobile : candidate.mobile;
    if (nextCc !== candidate.country_code || nextMob !== candidate.mobile) {
      const existingMobile = await db.User.findOne({
        where: { country_code: nextCc, mobile: nextMob, id: { [Op.ne]: candidateId } },
      });
      if (existingMobile) {
        return res.status(400).json({ status: 'error', message: 'Mobile number already exists', data: null });
      }
    }

    await db.sequelize.transaction(async (t) => {
      const userUpdate = {};
      if (first_name !== undefined) userUpdate.first_name = first_name;
      if (last_name !== undefined) userUpdate.last_name = last_name;
      if (email !== undefined) userUpdate.email = email;
      if (country_code !== undefined) userUpdate.country_code = country_code;
      if (mobile !== undefined) userUpdate.mobile = mobile;
      if (payload.contactNumber !== undefined && payload.contactNumber !== null) {
        userUpdate.phone = payload.contactNumber;
      }
      if (Object.keys(userUpdate).length) {
        await candidate.update(userUpdate, { transaction: t });
      }

      const existingApplication = await CandidateApplication.findOne({
        where: { userId: candidateId },
        transaction: t,
      });

      if (existingApplication) {
        await existingApplication.update(payload, { transaction: t });
      } else {
        await CandidateApplication.create({
          userId: candidateId,
          ...payload,
          status: 'draft',
        }, { transaction: t });
      }

      const existingCase = await db.Case.findOne({
        where: { candidateId },
        transaction: t,
      });

      let visaTypeId = null;
      if (payload.visaType) {
        const vt = await db.VisaType.findOne({
          where: { name: { [db.Sequelize.Op.iLike]: `%${payload.visaType}%` } },
          transaction: t,
        });
        if (vt) visaTypeId = vt.id;
      }

      const caseworkerId = req.body.caseworkerId;
      const assignedcaseworkerId = caseworkerId ? [Number(caseworkerId)] : null;

      if (existingCase) {
        await existingCase.update({
          visaTypeId: visaTypeId || existingCase.visaTypeId,
          nationality: payload.nationality || existingCase.nationality,
          assignedcaseworkerId: assignedcaseworkerId ?? existingCase.assignedcaseworkerId,
        }, { transaction: t });
      } else if (payload.nationality || payload.visaType || visaTypeId) {
        await db.Case.create({
          caseId: `CAS-${Math.floor(100000 + Math.random() * 900000)}`,
          candidateId,
          visaTypeId,
          status: 'Lead',
          priority: 'medium',
          targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nationality: payload.nationality || null,
          jobTitle: 'Candidate',
          assignedcaseworkerId,
        }, { transaction: t });
      }
    });

    const updatedCandidate = await db.User.findOne({
      where: { id: candidateId },
      attributes: {
        exclude: [
          'password',
          'otp_code',
          'otp_expiry',
          'password_reset_otp',
          'password_reset_otp_expiry',
          'temp_password',
        ],
      },
      include: [
        { model: db.Role, as: 'role', attributes: ['id', 'name'] },
        { model: CandidateApplication, as: 'application', required: false },
      ],
    });

    res.status(200).json({
      status: 'success',
      message: 'Candidate application updated successfully',
      data: { candidate: updatedCandidate },
    });
  } catch (err) {
    console.error('adminUpdateCandidateApplication error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

function exportCellValue(fieldKey, raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  if (DATE_FIELDS.has(fieldKey)) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return '';
  }
  if (typeof raw === 'object' && !(raw instanceof Date)) {
    try {
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  }
  return String(raw);
}

export const exportCandidateApplicationsExcel = async (req, res) => {
  try {
    const { search, status } = req.query;
    const whereClause = { role_id: 3 };
    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
      ];
    }
    if (status) {
      whereClause.status = status;
    }

    const settings = await db.ApplicationFieldSetting.findAll({
      order: [['field_order', 'ASC']],
    });
    const labelMap = {};
    for (const s of settings) {
      labelMap[s.field_key] = s.field_label;
    }

    const userCols = [
      { key: 'user_id', header: 'User ID' },
      { key: 'first_name', header: 'First Name' },
      { key: 'last_name', header: 'Last Name' },
      { key: 'email', header: 'Email' },
      { key: 'country_code', header: 'Country Code' },
      { key: 'mobile', header: 'Mobile' },
      { key: 'account_status', header: 'Account Status' },
    ];

    const appCols = APPLICATION_FIELDS.filter((k) => k !== 'customResponses').map((k) => ({
      key: `app_${k}`,
      header: labelMap[k] || humanizeFieldKey(k),
    }));
    appCols.push({
      key: 'app_customResponses',
      header: labelMap.customResponses || 'Custom responses',
    });

    const columns = [...userCols, ...appCols];

    const candidates = await db.User.findAll({
      where: whereClause,
      attributes: ['id', 'first_name', 'last_name', 'email', 'country_code', 'mobile', 'status'],
      include: [{ model: CandidateApplication, as: 'application', required: false }],
      order: [['createdAt', 'DESC']],
    });

    const rows = candidates.map((u) => {
      const appJson = u.application ? u.application.toJSON() : {};
      const row = {
        user_id: u.id,
        first_name: u.first_name ?? '',
        last_name: u.last_name ?? '',
        email: u.email ?? '',
        country_code: u.country_code ?? '',
        mobile: u.mobile ?? '',
        account_status: u.status ?? '',
      };
      for (const k of APPLICATION_FIELDS) {
        if (k === 'customResponses') continue;
        const v = appJson[k];
        row[`app_${k}`] = exportCellValue(k, v);
      }
      row.app_customResponses = appJson.customResponses
        ? JSON.stringify(appJson.customResponses)
        : '';
      return row;
    });

    const buf = rowsToXlsxBuffer(rows, columns);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="candidate-applications.xlsx"',
    );
    res.status(200).send(buf);
  } catch (err) {
    console.error('exportCandidateApplicationsExcel error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

function normalizeImportHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function buildImportHeaderMap() {
  const settings = await db.ApplicationFieldSetting.findAll();
  const map = {};
  map[normalizeImportHeader('User ID')] = 'meta:user_id';
  map[normalizeImportHeader('First Name')] = 'user:first_name';
  map[normalizeImportHeader('Last Name')] = 'user:last_name';
  map[normalizeImportHeader('Email')] = 'user:email';
  map[normalizeImportHeader('Country Code')] = 'user:country_code';
  map[normalizeImportHeader('Mobile')] = 'user:mobile';
  map[normalizeImportHeader('Account Status')] = 'user:status';
  for (const s of settings) {
    map[normalizeImportHeader(s.field_label)] = `app:${s.field_key}`;
  }
  for (const k of APPLICATION_FIELDS) {
    map[normalizeImportHeader(humanizeFieldKey(k))] = `app:${k}`;
  }
  map[normalizeImportHeader('Custom responses')] = 'app:customResponses';
  return map;
}

export const importCandidateApplicationsExcel = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded',
        data: null,
      });
    }

    const { headers, dataRows } = xlsxBufferToRows(req.file.buffer);
    if (!headers.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Spreadsheet has no headers',
        data: null,
      });
    }

    const headerMap = await buildImportHeaderMap();
    const results = { success: [], errors: [] };

    let rowNum = 2;
    for (const line of dataRows) {
      try {
        const userPatch = {};
        const appPatch = {};
        let metaUserId = null;

        headers.forEach((h, idx) => {
          const mapped = headerMap[normalizeImportHeader(h)];
          if (!mapped) return;
          let cell = line[idx];
          if (cell === undefined || cell === null) cell = '';
          if (typeof cell === 'number') cell = String(cell);
          else cell = String(cell).trim();

          if (mapped.startsWith('meta:')) {
            const mk = mapped.slice(5);
            if (mk === 'user_id' && cell) metaUserId = Number(cell);
            return;
          }
          if (mapped.startsWith('user:')) {
            const uk = mapped.slice(5);
            if (cell !== '') userPatch[uk] = cell;
            return;
          }
          if (mapped.startsWith('app:')) {
            const ak = mapped.slice(4);
            if (ak === 'customResponses' && cell) {
              try {
                appPatch.customResponses = JSON.parse(cell);
              } catch {
                appPatch.customResponses = {};
              }
            } else if (cell !== '') {
              appPatch[ak] = cell;
            }
          }
        });

        const firstName =
          userPatch.first_name ||
          appPatch.firstName ||
          '';
        const lastName =
          userPatch.last_name ||
          appPatch.lastName ||
          '';
        const emailAddr =
          userPatch.email ||
          appPatch.email ||
          '';

        if (!emailAddr || !String(emailAddr).includes('@')) {
          results.errors.push({ row: rowNum, error: 'Email is required' });
          rowNum += 1;
          continue;
        }

        const sanitized = pickFields(appPatch);

        await db.sequelize.transaction(async (t) => {
          let userRow = null;
          if (Number.isFinite(metaUserId) && metaUserId > 0) {
            userRow = await db.User.findOne({
              where: { id: metaUserId, role_id: 3 },
              transaction: t,
            });
          }
          if (!userRow) {
            userRow = await db.User.findOne({
              where: { email: emailAddr, role_id: 3 },
              transaction: t,
            });
          }

          if (userRow) {
            const uUp = {};
            if (firstName) uUp.first_name = firstName;
            if (lastName) uUp.last_name = lastName;
            if (userPatch.email) uUp.email = userPatch.email;
            if (userPatch.country_code) uUp.country_code = userPatch.country_code;
            if (userPatch.mobile) uUp.mobile = userPatch.mobile;
            if (userPatch.status) uUp.status = userPatch.status;
            if (sanitized.contactNumber) uUp.phone = sanitized.contactNumber;
            if (Object.keys(uUp).length) {
              await userRow.update(uUp, { transaction: t });
            }

            const existingApp = await CandidateApplication.findOne({
              where: { userId: userRow.id },
              transaction: t,
            });
            if (existingApp) {
              await existingApp.update(sanitized, { transaction: t });
            } else {
              await CandidateApplication.create(
                {
                  userId: userRow.id,
                  ...sanitized,
                  status: 'draft',
                },
                { transaction: t },
              );
            }
          } else {
            if (!firstName || !lastName) {
              throw new Error('First name and last name are required for new candidates');
            }
            const pwd =
              generateStrongPassword(12);
            const hashedPassword = await bcrypt.hash(pwd, 12);
            userRow = await db.User.create(
              {
                first_name: firstName,
                last_name: lastName,
                email: emailAddr,
                country_code: userPatch.country_code || '+44',
                mobile: userPatch.mobile || '',
                role_id: 3,
                password: hashedPassword,
                is_email_verified: true,
                is_otp_verified: true,
                status: userPatch.status || 'active',
                phone: sanitized.contactNumber || null,
              },
              { transaction: t },
            );

            await CandidateApplication.create(
              {
                userId: userRow.id,
                ...sanitized,
                status: 'draft',
              },
              { transaction: t },
            );

            results.success.push({
              row: rowNum,
              id: userRow.id,
              email: userRow.email,
              temporary_password: pwd,
              created: true,
            });
            return;
          }

          results.success.push({
            row: rowNum,
            id: userRow.id,
            email: userRow.email,
            updated: true,
          });
        });
      } catch (err) {
        results.errors.push({ row: rowNum, error: err.message });
      }
      rowNum += 1;
    }

    res.status(200).json({
      status: 'success',
      message: 'Import completed',
      data: {
        total_processed: dataRows.length,
        successful: results.success.length,
        failed: results.errors.length,
        results,
      },
    });
  } catch (err) {
    console.error('importCandidateApplicationsExcel error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      error: err.message,
    });
  }
};

function humanizeFieldKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatApplicationScalar(fieldKey, raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (DATE_FIELDS.has(fieldKey)) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return '—';
  }
  if (typeof raw === 'object' && !(raw instanceof Date)) {
    try {
      return JSON.stringify(raw);
    } catch {
      return '—';
    }
  }
  return String(raw);
}

function formatCaseDate(raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().split('T')[0];
}

async function buildFieldLabelMap() {
  const settings = await db.ApplicationFieldSetting.findAll({
    where: {
      field_type: { [db.Sequelize.Op.ne]: 'file' },
    },
    attributes: ['field_key', 'field_label'],
  });
  const map = {};
  for (const s of settings) {
    map[s.field_key] = s.field_label;
  }
  return map;
}

export const downloadFilledApplicationPdf = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const application = await CandidateApplication.findOne({ where: { userId } });
    if (!application) {
      return res.status(404).json({
        status: 'error',
        message: 'Application not found',
        data: null,
      });
    }

    const appJson = application.toJSON();
    const labelMap = await buildFieldLabelMap();
    const sections = PDF_APPLICATION_SECTIONS.map((sec) => ({
      sectionTitle: sec.title,
      rows: sec.fields.map((fieldKey) => ({
        label: labelMap[fieldKey] || humanizeFieldKey(fieldKey),
        value: formatApplicationScalar(fieldKey, appJson[fieldKey]),
      })),
    }));

    const customDefs = await db.ApplicationCustomField.findAll({
      where: { is_active: true },
      order: [['display_order', 'ASC']],
    });
    const responses =
      appJson.customResponses && typeof appJson.customResponses === 'object'
        ? appJson.customResponses
        : {};
    const customRows = [];
    const seenKeys = new Set();
    for (const cf of customDefs) {
      const key = cf.field_id;
      seenKeys.add(key);
      const val = responses[key] ?? responses[String(cf.id)] ?? null;
      customRows.push({
        label: cf.label,
        value: formatApplicationScalar(key, val),
      });
    }
    for (const [k, v] of Object.entries(responses)) {
      if (seenKeys.has(k)) continue;
      customRows.push({
        label: humanizeFieldKey(k),
        value: formatApplicationScalar(k, v),
      });
    }
    if (customRows.length) {
      sections.push({
        sectionTitle: 'Additional Questions',
        rows: customRows,
      });
    }

    const logoPath = path.join(process.cwd(), 'assets', 'elitepic_logo.png');
    const candidateName =
      `${appJson.firstName || ''} ${appJson.lastName || ''}`.trim() || 'Candidate';

    streamBrandedPdf(res, 'Filled_Application_Form.pdf', {
      logoPath,
      title: 'Filled Application Form',
      sections,
      metadata: {
        subtitle: 'Immigration application summary (candidate record)',
        reference: appJson.status ? `Application status: ${appJson.status}` : undefined,
        candidateName,
      },
    });
  } catch (err) {
    console.error('downloadFilledApplicationPdf error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        data: null,
        error: err.message,
      });
    }
  }
};

export const downloadCaseSummaryPdf = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const application = await CandidateApplication.findOne({ where: { userId } });
    const candidateNameFromApp = application
      ? `${application.firstName || ''} ${application.lastName || ''}`.trim()
      : '';

    const userRow = await db.User.findByPk(userId, {
      attributes: ['first_name', 'last_name', 'email'],
    });
    const displayName =
      candidateNameFromApp ||
      `${userRow?.first_name || ''} ${userRow?.last_name || ''}`.trim() ||
      userRow?.email ||
      'Candidate';

    const caseRecord = await db.Case.findOne({
      where: { candidateId: userId },
      order: [['created_at', 'DESC']],
      include: [
        { model: db.VisaType, as: 'visaType', attributes: ['id', 'name'] },
        { model: db.PetitionType, as: 'petitionType', attributes: ['id', 'name'] },
        { model: db.Department, as: 'department', attributes: ['id', 'name'] },
      ],
    });

    let timeline = [];
    if (caseRecord) {
      timeline = await db.CaseTimeline.findAll({
        where: { caseId: caseRecord.id, visibility: 'public' },
        include: [
          {
            model: db.User,
            as: 'performer',
            attributes: ['first_name', 'last_name'],
          },
        ],
        order: [['actionDate', 'ASC']],
      });
    }

    let assignedLines = '—';
    if (caseRecord?.assignedcaseworkerId) {
      const rawIds = Array.isArray(caseRecord.assignedcaseworkerId)
        ? caseRecord.assignedcaseworkerId
        : [caseRecord.assignedcaseworkerId];
      const uniq = [
        ...new Set(
          rawIds
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0),
        ),
      ];
      if (uniq.length) {
        const staff = await db.User.findAll({
          where: { id: uniq },
          attributes: ['first_name', 'last_name', 'email'],
        });
        assignedLines = staff
          .map((u) =>
            `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || '',
          )
          .filter(Boolean)
          .join('; ');
        if (!assignedLines) assignedLines = '—';
      }
    }

    const overviewRows = [
      { label: 'Candidate name', value: displayName },
      { label: 'Case reference', value: caseRecord?.caseId || '—' },
      { label: 'Current status', value: caseRecord?.status || '—' },
      { label: 'Pipeline stage', value: caseRecord?.caseStage || '—' },
      { label: 'Visa type', value: caseRecord?.visaType?.name || '—' },
      { label: 'Application category', value: caseRecord?.applicationType || '—' },
      { label: 'Petition type', value: caseRecord?.petitionType?.name || '—' },
      { label: 'Department', value: caseRecord?.department?.name || '—' },
      { label: 'Nationality (case record)', value: caseRecord?.nationality || '—' },
      { label: 'Priority', value: caseRecord?.priority || '—' },
      {
        label: 'Target submission date',
        value: formatCaseDate(caseRecord?.targetSubmissionDate),
      },
      {
        label: 'Submission date',
        value: formatCaseDate(caseRecord?.submissionDate),
      },
      {
        label: 'Decision date',
        value: formatCaseDate(caseRecord?.decisionDate),
      },
      {
        label: 'Biometrics date',
        value: formatCaseDate(caseRecord?.biometricsDate),
      },
      {
        label: 'Receipt number',
        value: caseRecord?.receiptNumber || '—',
      },
      {
        label: 'LCA number',
        value: caseRecord?.lcaNumber || '—',
      },
      { label: 'Assigned caseworker(s)', value: assignedLines },
    ];

    const timelineRows = timeline.map((t) => {
      const who = t.performer
        ? `${t.performer.first_name || ''} ${t.performer.last_name || ''}`.trim()
        : '—';
      const when = formatCaseDate(t.actionDate);
      return {
        label: `${when} · ${t.actionType}`,
        value: `${t.description || '—'} (${who})`,
      };
    });

    const summaryParagraphs = [];
    if (!caseRecord) {
      summaryParagraphs.push(
        'No immigration case record is currently linked to this account. When a case is opened, status and timeline information will appear in this report.',
      );
    } else {
      summaryParagraphs.push(
        `This report summarises the latest information held for case reference ${caseRecord.caseId || 'N/A'}. The timeline lists publicly visible milestones in chronological order. For formal guidance, rely on correspondence from your caseworker or the relevant authority.`,
      );
    }

    const sections = [
      { sectionTitle: 'Case overview', rows: overviewRows },
      {
        sectionTitle: 'Summary',
        paragraphs: summaryParagraphs,
        rows: [],
      },
      {
        sectionTitle: 'Timeline (public milestones)',
        rows: timelineRows.length
          ? timelineRows
          : [{ label: '—', value: 'No timeline entries recorded.' }],
      },
    ];

    const logoPath = path.join(process.cwd(), 'assets', 'elitepic_logo.png');

    streamBrandedPdf(res, 'Case_Summary_Report.pdf', {
      logoPath,
      title: 'Case Summary Report',
      sections,
      metadata: {
        subtitle: 'Candidate case status overview',
        reference: caseRecord?.caseId ? `Reference: ${caseRecord.caseId}` : undefined,
        candidateName: displayName,
      },
    });
  } catch (err) {
    console.error('downloadCaseSummaryPdf error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        data: null,
        error: err.message,
      });
    }
  }
};
