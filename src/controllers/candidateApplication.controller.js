import db from '../models/index.js';

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
  // applicationType  → ENUM('Single', 'Family')
  'applicationType',
  // Yes/No ENUMs
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
 * This prevents PostgreSQL from receiving invalid input for typed columns.
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
      // Store null for any falsy / blank value so the DB gets NULL not ""
      payload[key] = (v === null || v === undefined || String(v).trim() === '')
        ? null
        : v;
    } else {
      payload[key] = v;
    }
  }
  return payload;
}

/** GET /api/candidate-application — load the logged-in candidate's application */
export const getMyApplication = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const application = await CandidateApplication.findOne({ where: { userId } });

    res.status(200).json({
      status: 'success',
      message: 'Application loaded',
      data: { application: application || null },
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

/** POST /api/candidate-application — submit the application (creates or updates, marks as submitted) */
export const submitApplication = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const payload = pickFields(req.body || {});

    const existing = await CandidateApplication.findOne({ where: { userId } });

    let application;
    if (existing) {
      await existing.update({
        ...payload,
        status: 'submitted',
        submittedAt: new Date(),
      });
      await existing.reload();
      application = existing;
    } else {
      application = await CandidateApplication.create({
        userId,
        ...payload,
        status: 'submitted',
        submittedAt: new Date(),
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Application submitted successfully',
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

/** PUT /api/candidate-application — save a draft without changing submission status */
export const saveDraft = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Invalid session', data: null });
    }

    const payload = pickFields(req.body || {});

    const existing = await CandidateApplication.findOne({ where: { userId } });

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
      status: 'success',
      message: 'Draft saved successfully',
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
