import logger from '../../../utils/logger.js';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { notifyCaseCreated } from '../../../services/notification.service.js';
import { addTimelineEntry } from '../../../services/timeline.service.js';
import { localDateStr } from '../../../utils/dateHelpers.js';
import { generateBrandedPdfBuffer } from '../../../services/pdfGenerator.service.js';
import { rowsToXlsxBuffer, xlsxBufferToRows } from '../../../utils/excelExport.util.js';
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import { generateStrongPassword } from '../../../utils/passwordGenerator.js';
import { EVENTS } from '../../../core/events/eventRegistry.js';
import eventPublisher from '../../../core/events/eventPublisher.js';
import { generateCaseId } from '../../../utils/case.utils.js';
import { getWorkflowState } from '../../../services/caseWorkflowProcess.service.js';
import { resolveCaseStage, DEFAULT_CASE_STAGE } from '../../../constants/immigrationCaseProcess.js';
import { syncWorkflowTasksForStage } from '../../../services/workflowTaskAutomation.service.js';

/**
 * Every form field that a candidate can save / submit.
 * Matches the fields defined in req.tenantDb.CandidateApplication.model.js exactly.
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

    const settings = await req.tenantDb.ApplicationFieldSetting.findAll({
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
    logger.error({ err }, 'getCandidateApplicationFieldSettings error');
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

    const customFields = await req.tenantDb.ApplicationCustomField.findAll({
      where: { is_active: true },
      order: [['display_order', 'ASC']],
    });

    res.status(200).json({
      status: 'success',
      message: 'Custom fields loaded',
      data: customFields.map((f) => f.toJSON()),
    });
  } catch (err) {
    logger.error({ err }, 'getCandidateApplicationCustomFields error');
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

    const application = await req.tenantDb.CandidateApplication.findOne({
      where: { userId },
      include: [
        {
          model: req.tenantDb.User,
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
      const cases = await req.tenantDb.Case.findAll({
        where: { candidateId: userId },
        include: [
          {
            model: req.tenantDb.VisaType,
            as: 'visaType',
            attributes: ['id', 'name'],
          },
          {
            model: req.tenantDb.CaseTimeline,
            as: 'timeline',
            where: { visibility: 'public' },
            required: false,
            order: [['actionDate', 'DESC']],
          },
        ],
        order: [['created_at', 'DESC']],
      });

      // Fetch all documents belonging to this user
      const documents = await req.tenantDb.Document.findAll({
        where: { userId },
        order: [['created_at', 'DESC']],
      });

      // Fetch admin-configured required document types
      const documentSettings = await req.tenantDb.ApplicationFieldSetting.findAll({
        where: { field_type: 'file', is_visible: true },
        attributes: ['id', 'field_key', 'field_label', 'is_required'],
      });

      const completionScore = computeCompletionScore(
        application.toJSON(),
        documents,
        documentSettings
      );

      const primaryCase = cases[0];
      if (primaryCase) {
        if (req.tenantDb.DataCaptureSubmission) {
          const dcs = await req.tenantDb.DataCaptureSubmission.findOne({
            where: { caseId: primaryCase.id },
          });
          relatedData.dataCaptureSubmission = dcs ? dcs.get({ plain: true }) : null;
        }
        if (req.tenantDb.CaseCclRecord) {
          const ccl = await req.tenantDb.CaseCclRecord.findOne({
            where: { caseId: primaryCase.id },
          });
          relatedData.cclRecord = ccl ? ccl.get({ plain: true }) : null;
        }
      }

      relatedData.cases = cases.map((c) => {
        const plain = c.get({ plain: true });
        plain.workflowState = getWorkflowState(plain);
        return plain;
      });
      relatedData.documents = documents.map((d) => d.get({ plain: true }));
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
    logger.error({ err }, 'getMyApplication error');
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

    const alreadySubmitted = await req.tenantDb.CandidateApplication.findOne({ where: { userId } });
    const caseRecord = await req.tenantDb.Case.findOne({
      where: { candidateId: userId },
      order: [['created_at', 'DESC']],
    });
    const stage = caseRecord ? resolveCaseStage(caseRecord) : null;
    const ws = caseRecord ? getWorkflowState(caseRecord) : null;
    const draftRevisionAllowed =
      stage === 'draft_application_review' && ws?.draftReview?.confirmed === false;

    if (
      alreadySubmitted &&
      alreadySubmitted.status === 'submitted' &&
      alreadySubmitted.isLocked &&
      !draftRevisionAllowed
    ) {
      if (stage === 'draft_application_review' && ws?.draftReview?.confirmed === null) {
        return res.status(403).json({
          success: false,
          message: 'Please confirm or reject the draft application review before submitting changes.',
        });
      }
      return res.status(409).json({
        success: false,
        message: 'Your application has already been submitted and is currently under review.',
      });
    }

    const payload = pickFields(req.body || {});

    // ── Uniqueness: BRP, National Insurance and passport numbers must each be
    // unique across applicants (a duplicate usually means a typo or reused doc).
    const uniqueChecks = [
      { field: 'brpNumber', label: 'BRP permit number' },
      { field: 'niNumber', label: 'National Insurance number' },
      { field: 'passportNumber', label: 'Passport number' },
    ];
    const Op = req.tenantDb.Sequelize.Op;
    for (const { field, label } of uniqueChecks) {
      const value = payload[field]?.toString().trim();
      if (!value) continue;
      const duplicate = await req.tenantDb.CandidateApplication.findOne({
        where: { [field]: { [Op.iLike]: value }, userId: { [Op.ne]: userId } },
        attributes: ['id'],
      });
      if (duplicate) {
        return res.status(409).json({
          status: 'error',
          success: false,
          message: `This ${label} is already registered to another applicant. Please check and correct it.`,
          field,
          data: null,
        });
      }
    }

    const application = await req.tenantDb.sequelize.transaction(async (t) => {
      const existing = await req.tenantDb.CandidateApplication.findOne({
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
        app = await req.tenantDb.CandidateApplication.create({
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
        const vt = await req.tenantDb.VisaType.findOne({
          where: { name: { [req.tenantDb.Sequelize.Op.iLike]: `%${payload.visaType}%` } },
          transaction: t,
        });
        if (vt) visaTypeId = vt.id;
      }

      const caseworkerId = req.body.caseworkerId;
      const assignedcaseworkerId = caseworkerId ? [Number(caseworkerId)] : null;

      const existingCase = await req.tenantDb.Case.findOne({
        where: { candidateId: userId },
        transaction: t,
      });

      const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

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
        const caseIdStr = await generateCaseId(req.tenantDb);
        const caseRecord = await req.tenantDb.Case.create(
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
            organisation_id: organisationId,
          },
          { transaction: t }
        );

        await notifyCaseCreated(req.tenantDb, {
          id: caseRecord.id,
          caseId: caseRecord.caseId,
          candidateName: `${app.firstName} ${app.lastName}`,
        });

        await addTimelineEntry({
          tenantDb: req.tenantDb,
          caseId: caseRecord.id,
          actionType: 'case_created',
          description: `Case ${caseRecord.caseId} created for ${app.firstName} ${app.lastName}`,
          performedBy: userId,
          visibility: 'public',
        });
      }

      const targetCase =
        existingCase ||
        (await req.tenantDb.Case.findOne({ where: { candidateId: userId }, transaction: t }));

      if (targetCase) {
        // Link any orphaned documents uploaded by this user to this case
        await req.tenantDb.Document.update(
          { caseId: targetCase.id },
          { 
            where: { userId, caseId: null },
            transaction: t 
          }
        );

        await addTimelineEntry({
          tenantDb: req.tenantDb,
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

    // Run async workflow tasks generation after transaction completes
    try {
      const caseRecordAfter = await req.tenantDb.Case.findOne({ where: { candidateId: userId } });
      if (caseRecordAfter) {
        await syncWorkflowTasksForStage({
          tenantDb: req.tenantDb,
          caseRecord: caseRecordAfter,
          stageId: DEFAULT_CASE_STAGE,
          performedBy: userId,
          organisationId: req.user?.organisation_id ? Number(req.user.organisation_id) : null,
        });
      }
    } catch (taskErr) {
      logger.error({ err: taskErr }, 'Error syncing workflow tasks after application submit');
    }
  } catch (err) {
    logger.error({ err }, 'submitApplication error');
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

    const existing = await req.tenantDb.CandidateApplication.findOne({ where: { userId } });

    // Guard: locked applications cannot be edited (except after draft review "No")
    if (existing && existing.isLocked) {
      const caseRecord = await req.tenantDb.Case.findOne({
        where: { candidateId: userId },
        order: [['created_at', 'DESC']],
      });
      const stage = caseRecord ? resolveCaseStage(caseRecord) : null;
      const ws = caseRecord ? getWorkflowState(caseRecord) : null;
      const draftRevisionAllowed =
        stage === 'draft_application_review' && ws?.draftReview?.confirmed === false;
      if (!draftRevisionAllowed) {
        return res.status(403).json({
          success: false,
          message: 'Your application is locked and cannot be edited. Contact your caseworker.',
        });
      }
    }

    const payload = pickFields(req.body || {});

    let application;
    if (existing) {
      await existing.update(payload);
      await existing.reload();
      application = existing;
    } else {
      application = await req.tenantDb.CandidateApplication.create({
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
    logger.error({ err }, 'saveDraft error');
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

    const application = await req.tenantDb.CandidateApplication.findOne({ where: { userId: candidateId } });
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    application.isLocked = false;
    await application.save();

    res.status(200).json({ success: true, message: 'Application unlocked successfully.' });
  } catch (err) {
    logger.error({ err }, 'unlockApplication error');
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

    const candidate = await req.tenantDb.User.findOne({ where: { id: candidateId, role_id: 1 } });
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
      const existingEmail = await req.tenantDb.User.findOne({
        where: { email, id: { [Op.ne]: candidateId } },
      });
      if (existingEmail) {
        return res.status(400).json({ status: 'error', message: 'Email already exists', data: null });
      }
    }

    const nextCc = country_code !== undefined ? country_code : candidate.country_code;
    const nextMob = mobile !== undefined ? mobile : candidate.mobile;
    if (nextCc !== candidate.country_code || nextMob !== candidate.mobile) {
      const existingMobile = await req.tenantDb.User.findOne({
        where: { country_code: nextCc, mobile: nextMob, id: { [Op.ne]: candidateId } },
      });
      if (existingMobile) {
        return res.status(400).json({ status: 'error', message: 'Mobile number already exists', data: null });
      }
    }

    await req.tenantDb.sequelize.transaction(async (t) => {
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

      const existingApplication = await req.tenantDb.CandidateApplication.findOne({
        where: { userId: candidateId },
        transaction: t,
      });

      if (existingApplication) {
        await existingApplication.update(payload, { transaction: t });
      } else {
        await req.tenantDb.CandidateApplication.create({
          userId: candidateId,
          ...payload,
          status: 'draft',
        }, { transaction: t });
      }

      const existingCase = await req.tenantDb.Case.findOne({
        where: { candidateId },
        transaction: t,
      });

      let visaTypeId = null;
      if (payload.visaType) {
        const vt = await req.tenantDb.VisaType.findOne({
          where: { name: { [req.tenantDb.Sequelize.Op.iLike]: `%${payload.visaType}%` } },
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
        const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
        await req.tenantDb.Case.create({
          caseId: await generateCaseId(req.tenantDb),
          candidateId,
          visaTypeId,
          status: 'Lead',
          priority: 'medium',
          targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nationality: payload.nationality || null,
          jobTitle: 'Candidate',
          assignedcaseworkerId,
          organisation_id: organisationId,
        }, { transaction: t });
      }
    });

    const updatedCandidate = await req.tenantDb.User.findOne({
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
        { model: req.tenantDb.Role, as: 'role', attributes: ['id', 'name'] },
        { model: req.tenantDb.CandidateApplication, as: 'application', required: false },
      ],
    });

    // Fire PROFILE_UPDATED Event to trigger Timeline & Notifications (Phase 8/13 Integration)
    const existingCase = await req.tenantDb.Case.findOne({ where: { candidateId } });
    if (existingCase) {
      const description = `Application form updated by Administrator/Caseworker.`;
      eventPublisher.publish(EVENTS.PROFILE_UPDATED, {
        entityId: existingCase.id,
        entityType: 'case',
        candidateId,
        assignedCaseworkerId: existingCase.assignedcaseworkerId,
        performedById: req.user?.id || null,
        performedByRole: req.user?.role?.name || req.user?.role || 'admin',
        description,
        actionType: 'case_updated'
      }, { tenantDb: req.tenantDb, io: req.app.get('io'), organisationId: req.user?.organisation_id }).catch(err => logger.error({ err }, 'Publish PROFILE_UPDATED error in admin update'));
    }

    res.status(200).json({
      status: 'success',
      message: 'Candidate application updated successfully',
      data: { candidate: updatedCandidate },
    });
  } catch (err) {
    logger.error({ err }, 'adminUpdateCandidateApplication error');
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
    if (!isNaN(d.getTime())) return localDateStr(d);
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
    const { search, status, visaType, paymentStatus } = req.query;
    // role_id 1 = CANDIDATE (not 3 which is ADMIN)
    const whereClause = { role_id: 1 };
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

    const settings = await req.tenantDb.ApplicationFieldSetting.findAll({
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

    // Build case include with optional visaType filter
    const caseInclude = {
      model: req.tenantDb.Case,
      as: 'cases',
      required: false,
      attributes: ['id', 'status', 'totalAmount', 'paidAmount', 'nationality'],
      include: [{ model: req.tenantDb.VisaType, as: 'visaType', attributes: ['id', 'name'] }],
    };

    // Filter by visaType via application field
    const appIncludeWhere = {};
    if (visaType) {
      appIncludeWhere.visaType = visaType;
    }

    const candidates = await req.tenantDb.User.findAll({
      where: whereClause,
      attributes: ['id', 'first_name', 'last_name', 'email', 'country_code', 'mobile', 'status'],
      include: [
        {
          model: req.tenantDb.CandidateApplication,
          as: 'application',
          required: visaType ? true : false,
          where: Object.keys(appIncludeWhere).length ? appIncludeWhere : undefined,
        },
        caseInclude,
      ],
      order: [['createdAt', 'DESC']],
    });

    // Filter by paymentStatus in JS (derived field)
    const filteredCandidates = paymentStatus
      ? candidates.filter((u) => {
          const c = u.cases?.[0];
          if (!c) return paymentStatus === 'Outstanding';
          const total = parseFloat(c.totalAmount || 0);
          const paid = parseFloat(c.paidAmount || 0);
          const computed = total === 0 ? 'Outstanding' : paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Outstanding';
          return computed === paymentStatus;
        })
      : candidates;

    const rows = filteredCandidates.map((u) => {
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
    logger.error({ err }, 'exportCandidateApplicationsExcel error');
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

async function buildImportHeaderMap(req) {
  const settings = await req.tenantDb.ApplicationFieldSetting.findAll();
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

    const headerMap = await buildImportHeaderMap(req);
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

        await req.tenantDb.sequelize.transaction(async (t) => {
          let userRow = null;
          if (Number.isFinite(metaUserId) && metaUserId > 0) {
            userRow = await req.tenantDb.User.findOne({
              where: { id: metaUserId, role_id: 1 },
              transaction: t,
            });
          }
          if (!userRow) {
            userRow = await req.tenantDb.User.findOne({
              where: { email: emailAddr, role_id: 1 },
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

            const existingApp = await req.tenantDb.CandidateApplication.findOne({
              where: { userId: userRow.id },
              transaction: t,
            });
            if (existingApp) {
              await existingApp.update(sanitized, { transaction: t });
            } else {
              await req.tenantDb.CandidateApplication.create(
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
            userRow = await req.tenantDb.User.create(
              {
                first_name: firstName,
                last_name: lastName,
                email: emailAddr,
                country_code: userPatch.country_code || '+44',
                mobile: userPatch.mobile || '',
                role_id: 1,
                password: hashedPassword,
                is_email_verified: true,
                is_otp_verified: true,
                status: userPatch.status || 'active',
                phone: sanitized.contactNumber || null,
              },
              { transaction: t },
            );

            await req.tenantDb.CandidateApplication.create(
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
    logger.error({ err }, 'importCandidateApplicationsExcel error');
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
    if (!isNaN(d.getTime())) return localDateStr(d);
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
  return localDateStr(d);
}

async function buildFieldLabelMap(tenantDb) {
  const settings = await tenantDb.ApplicationFieldSetting.findAll({
    where: {
      field_type: { [tenantDb.Sequelize.Op.ne]: 'file' },
    },
    attributes: ['field_key', 'field_label'],
  });
  const map = {};
  for (const s of settings) {
    map[s.field_key] = s.field_label;
  }
  return map;
}

export const downloadFilledApplicationPdf = catchAsync(async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return ApiResponse.unauthorized(res, 'Invalid session');
    }

    const application = await req.tenantDb.CandidateApplication.findOne({ where: { userId } });
    if (!application) {
      return ApiResponse.notFound(res, 'Application not found');
    }

    const appJson = application.toJSON();
    const labelMap = await buildFieldLabelMap(req.tenantDb);
    const sections = PDF_APPLICATION_SECTIONS.map((sec) => ({
      sectionTitle: sec.title,
      rows: sec.fields.map((fieldKey) => ({
        label: labelMap[fieldKey] || humanizeFieldKey(fieldKey),
        value: formatApplicationScalar(fieldKey, appJson[fieldKey]),
      })),
    }));

    const customDefs = await req.tenantDb.ApplicationCustomField.findAll({
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

    const buffer = await generateBrandedPdfBuffer({
      logoPath,
      title: 'Filled Application Form',
      sections,
      metadata: {
        subtitle: 'Immigration application summary (candidate record)',
        reference: appJson.status ? `Application status: ${appJson.status}` : undefined,
        candidateName,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Filled_Application_Form.pdf"',
    );
    res.status(200).send(buffer);
  } catch (err) {
    if (res.headersSent) return;
    return ApiResponse.error(
      res,
      'Failed to generate filled application PDF',
      500,
      err,
    );
  }
});

export const downloadCaseSummaryPdf = catchAsync(async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return ApiResponse.unauthorized(res, 'Invalid session');
    }

    const application = await req.tenantDb.CandidateApplication.findOne({ where: { userId } });
    const candidateNameFromApp = application
      ? `${application.firstName || ''} ${application.lastName || ''}`.trim()
      : '';

    const userRow = await req.tenantDb.User.findByPk(userId, {
      attributes: ['first_name', 'last_name', 'email'],
    });
    const displayName =
      candidateNameFromApp ||
      `${userRow?.first_name || ''} ${userRow?.last_name || ''}`.trim() ||
      userRow?.email ||
      'Candidate';

    const caseRecord = await req.tenantDb.Case.findOne({
      where: { candidateId: userId },
      order: [['created_at', 'DESC']],
      include: [
        { model: req.tenantDb.VisaType, as: 'visaType', attributes: ['id', 'name'] },
        { model: req.tenantDb.PetitionType, as: 'petitionType', attributes: ['id', 'name'] },
        { model: req.tenantDb.Department, as: 'department', attributes: ['id', 'name'] },
      ],
    });

    let timeline = [];
    if (caseRecord) {
      timeline = await req.tenantDb.CaseTimeline.findAll({
        where: { caseId: caseRecord.id, visibility: 'public' },
        include: [
          {
            model: req.tenantDb.User,
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
        const staff = await req.tenantDb.User.findAll({
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

    const buffer = await generateBrandedPdfBuffer({
      logoPath,
      title: 'Case Summary Report',
      sections,
      metadata: {
        subtitle: 'Candidate case status overview',
        reference: caseRecord?.caseId ? `Reference: ${caseRecord.caseId}` : undefined,
        candidateName: displayName,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Case_Summary_Report.pdf"',
    );
    res.status(200).send(buffer);
  } catch (err) {
    if (res.headersSent) return;
    return ApiResponse.error(
      res,
      'Failed to generate case summary PDF',
      500,
      err,
    );
  }
});

export const downloadCandidateApplicationPdf = catchAsync(async (req, res) => {
  // Route param is `:id` (see Admin/Candidates/candidate.routes.js); fall back to
  // `candidateId` for any caller that mounts this under a differently-named param.
  const candidateId = req.params.id ?? req.params.candidateId;
  const numId = Number(candidateId);
  if (!Number.isFinite(numId) || numId <= 0) {
    return ApiResponse.badRequest(res, "Invalid candidateId");
  }

  const application = await req.tenantDb.CandidateApplication.findOne({
    where: { userId: numId },
  });
  if (!application) {
    return ApiResponse.notFound(res, "Application not found");
  }

  const appJson = application.toJSON();
  const labelMap = await buildFieldLabelMap(req.tenantDb);

  const sections = PDF_APPLICATION_SECTIONS.map((sec) => ({
    sectionTitle: sec.title,
    rows: sec.fields.map((fieldKey) => ({
      label: labelMap[fieldKey] || humanizeFieldKey(fieldKey),
      value: formatApplicationScalar(fieldKey, appJson[fieldKey]),
    })),
  }));

  const customDefs = await req.tenantDb.ApplicationCustomField.findAll({
    where: { is_active: true },
    order: [["display_order", "ASC"]],
  });

  const responses =
    appJson.customResponses && typeof appJson.customResponses === "object"
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
      sectionTitle: "Additional Questions",
      rows: customRows,
    });
  }

  const logoPath = path.join(process.cwd(), "assets", "elitepic_logo.png");
  const candidateName =
    `${appJson.firstName || ""} ${appJson.lastName || ""}`.trim() || "Client";

  const buffer = await generateBrandedPdfBuffer({
    logoPath,
    title: "Client Application",
    sections,
    metadata: {
      subtitle: "Immigration application export (admin)",
      reference: `Client application for ${candidateName}`,
      candidateName,
    },
  });

  const safe = candidateName
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .toLowerCase();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="application-${safe || "client"}.pdf"`,
  );
  res.status(200).send(buffer);
});
