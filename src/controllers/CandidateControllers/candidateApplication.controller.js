import db from '../../models/index.js';
import { notifyCaseCreated } from '../../services/notification.service.js';
import { addTimelineEntry } from '../../services/timeline.service.js';

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

/** PATCH /api/candidate-application/:candidateId/unlock — admin/caseworker unlocks a submitted application */
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
