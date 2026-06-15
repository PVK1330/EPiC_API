import bcrypt from 'bcryptjs';
import { Op, Sequelize } from 'sequelize';
import { CandidateRepository } from './candidate.repository.js';
import { generateStrongPassword } from '../../../utils/passwordGenerator.js';
import { notifyUserCreated, notifyUser } from '../../../services/notification.service.js';
import { ROLES } from '../../../middlewares/role.middleware.js';
import {
  createUserOnPlatformAndTenant,
  syncUserToPlatformOnly,
} from '../../../services/userSync.service.js';
import { sendCandidateWelcomeEmail } from '../../../services/candidateMail.service.js';
import { ensureCandidateEnquiryCase } from '../../../services/candidateOnboarding.service.js';
import { DEFAULT_CASE_STAGE } from '../../../constants/immigrationCaseProcess.js';
import { sanitizeApplicationPayload } from '../../../utils/applicationPayload.util.js';
import { createWorkflowTask, getActiveAdminIds } from '../../../services/workflowTaskAutomation.service.js';
import logger from '../../../utils/logger.js';
import { recordTimelineEntry } from '../../../services/caseTimeline.service.js';
import eventPublisher from '../../../core/events/eventPublisher.js';
import { EVENTS } from '../../../core/events/eventRegistry.js';

const APPLICATION_PAYLOAD_USER_KEYS = new Set([
  'first_name',
  'last_name',
  'email',
  'country_code',
  'mobile',
  'caseworkerId',
]);

/** Split admin PUT body into user profile vs application columns. */
function splitApplicationUpdatePayload(data) {
  const payload = data && typeof data === 'object' ? { ...data } : {};
  const userPatch = {};

  if (payload.first_name !== undefined) {
    userPatch.first_name = String(payload.first_name).trim();
  }
  if (payload.last_name !== undefined) {
    userPatch.last_name = String(payload.last_name).trim();
  }
  if (payload.email !== undefined) {
    userPatch.email = String(payload.email).trim().toLowerCase();
  }
  if (payload.country_code !== undefined) {
    userPatch.country_code = String(payload.country_code).trim();
  }
  if (payload.mobile !== undefined) {
    userPatch.mobile = String(payload.mobile).trim().replace(/\s/g, '');
  }

  const caseworkerId = payload.caseworkerId;
  for (const key of APPLICATION_PAYLOAD_USER_KEYS) {
    delete payload[key];
  }

  return { userPatch, applicationPatch: payload, caseworkerId };
}

// ── Candidate update field policy ──────────────────────────────────────────
// Whitelist: only these profile fields may be updated via updateCandidate().
// There is no `phone`/`address` column on users — contact is country_code+mobile.
export const CANDIDATE_UPDATABLE_FIELDS = Object.freeze([
  "first_name",
  "last_name",
  "email",
  "country_code",
  "mobile",
  "gender",
  "profile_pic",
]);

// Privilege-/security-sensitive columns. Any attempt to set one through a
// profile update is treated as a mass-assignment attack: logged and rejected.
// Credentials (password) must go through resetCandidatePassword() only.
export const CANDIDATE_PROTECTED_FIELDS = Object.freeze([
  "id",
  "role_id",
  "organisation_id",
  "status",
  "password",
  "temp_password",
  "is_email_verified",
  "is_otp_verified",
  "otp_code",
  "otp_expiry",
  "password_reset_otp",
  "password_reset_otp_expiry",
  "two_factor_secret",
  "two_factor_enabled",
  "two_factor_backup_codes",
  "password_changed_at",
  "failed_login_attempts",
  "locked_until",
  "last_login",
]);

/**
 * Partition an incoming candidate-update payload into the fields that may be
 * persisted vs. those that are rejected. `application` is handled separately
 * by the application-sync logic and is ignored here.
 *
 * @param {object} data
 * @returns {{ updateData: object, protectedAttempts: string[], unknownFields: string[] }}
 */
export function partitionCandidateUpdate(data = {}) {
  const updateData = {};
  const protectedAttempts = [];
  const unknownFields = [];

  for (const key of Object.keys(data || {})) {
    if (key === "application") continue; // synced separately, not a user column
    if (CANDIDATE_UPDATABLE_FIELDS.includes(key)) {
      updateData[key] = data[key];
    } else if (CANDIDATE_PROTECTED_FIELDS.includes(key)) {
      protectedAttempts.push(key);
    } else {
      unknownFields.push(key);
    }
  }

  return { updateData, protectedAttempts, unknownFields };
}

export class CandidateService {
  constructor(tenantDb) {
    this.repository = new CandidateRepository(tenantDb);
  }

  async createCandidate(data, context, performedByUser) {
    const {
      first_name, last_name, email, country_code, mobile,
      password, application, applicationData, role_id = ROLES.CANDIDATE,
      organisation_id,
      ...legacyFields
    } = data;

    if (!organisation_id) {
      throw new Error("organisation_id is required — users must belong to an organisation");
    }

    // Email/Mobile Check
    const existingEmail = await this.repository.findByEmail(email);
    if (existingEmail) throw new Error("Email already exists");

    const existingMobile = await this.repository.findByMobile(country_code, mobile);
    if (existingMobile) throw new Error("Mobile number already exists");

    const role = await this.repository.findRoleById(role_id);
    if (!role) throw new Error("Invalid role ID");

    const generatedPassword = password || generateStrongPassword(12);
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const candidate = await this.repository.transaction(async (t) => {
      // 1. Create on Platform & Tenant using unified service
      const newUser = await createUserOnPlatformAndTenant(this.repository.tenantDb, {
        first_name, 
        last_name, 
        email, 
        country_code, 
        mobile,
        role_id: ROLES.CANDIDATE,
        password: hashedPassword,
        is_email_verified: true,
        is_otp_verified: true,
        status: "active",
        organisation_id,
        ...legacyFields
      });

      // newUser is the Platform User instance, but it's already mirrored to Tenant

      if (application && typeof application === "object") {
        await this.repository.createApplication({
          userId: newUser.id,
          ...sanitizeApplicationPayload(application),
          organisation_id,
        }, t);

        let visaTypeId = null;
        if (application.visaType) {
          const vt = await this.repository.findVisaTypeByName(application.visaType, t);
          if (vt) visaTypeId = vt.id;
        }

        const caseworkerId = application.caseworkerId;
        const assignedcaseworkerId = caseworkerId ? [Number(caseworkerId)] : null;

        await this.repository.createCase({
          caseId: `CAS-${Math.floor(100000 + Math.random() * 900000)}`,
          candidateId: newUser.id,
          visaTypeId,
          status: 'Lead',
          caseStage: DEFAULT_CASE_STAGE,
          priority: 'medium',
          targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nationality: application.nationality || null,
          jobTitle: legacyFields.jobTitle || 'Client enquiry',
          assignedcaseworkerId,
          organisation_id,
        }, t);
      }

      return newUser;
    });

    const caseRecord = await this.repository.tenantDb.Case.findOne({
      where: { candidateId: candidate.id },
      order: [['created_at', 'DESC']]
    });

    if (!application) {
      await ensureCandidateEnquiryCase(this.repository.tenantDb, candidate.id, {
        visaTypeName: application?.visaType || null,
        organisationId: organisation_id,
      });
    }

    sendCandidateWelcomeEmail({
      user: candidate,
      plainPassword: generatedPassword,
      organisationId: organisation_id,
    }).catch((err) => logger.error({ err }, "Candidate welcome email"));

    // Background notification via Event Bus
    eventPublisher.publish(EVENTS.USER_CREATED, {
      candidateId: candidate.id,
      email: candidate.email,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      organisationId: organisation_id
    }, context).catch(err => logger.error({ err }, "Event Publish Error"));

    // Assign Task to Admins
    if (caseRecord && (!caseRecord.assignedcaseworkerId || caseRecord.assignedcaseworkerId.length === 0)) {
      const adminIds = await getActiveAdminIds(this.repository.tenantDb).catch(() => []);
      for (const adminId of adminIds) {
        createWorkflowTask({
          tenantDb: this.repository.tenantDb,
          caseRecord,
          assigneeId: adminId,
          title: `Assign a caseworker to this case — ${caseRecord.caseId}`,
          priority: 'high',
          dueInDays: 1,
          organisationId: organisation_id,
        }).catch((err) => logger.error({ err }, "Create Admin Task Error"));
      }
    }

    // Assign Task to Candidate
    if (caseRecord) {
      createWorkflowTask({
        tenantDb: this.repository.tenantDb,
        caseRecord,
        assigneeId: candidate.id,
        title: `Review the form and fill the form and submit`,
        priority: 'high',
        dueInDays: 3,
        organisationId: organisation_id,
      }).catch((err) => logger.error({ err }, "Create Candidate Task Error"));
    }

    return {
      candidate,
      temporary_password: !password ? generatedPassword : null
    };
  }

  async getAllCandidates(query) {
    const { page = 1, limit = 10, search, status, visaType, paymentStatus } = query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;
    const sequelize = this.repository.tenantDb.sequelize;

    const whereClause = { role_id: ROLES.CANDIDATE };
    const andConditions = [];
    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
      ];
    }
    // "Delete" is a soft delete (sets status: "inactive"). By default the list
    // hides inactive candidates so a deleted record drops out of view and does
    // not reappear on refresh. They remain in the DB and are still reachable by
    // explicitly selecting the "inactive" status filter.
    if (status) {
      whereClause.status = status;
    } else {
      whereClause.status = { [Op.ne]: "inactive" };
    }

    // Visa-type filter. The candidate's visa lives in two places: the
    // application's free-text `visaType` ("Skilled Worker Visa") and the case's
    // linked VisaType.name. The frontend sends a short label ("Skilled Worker"),
    // so we match on a normalised (lowercased, alphanumerics-only) substring
    // against *either* source via a correlated EXISTS subquery. This keeps
    // findAndCountAll's pagination/count correct (no extra include rows).
    if (visaType) {
      const normFilter = String(visaType).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normFilter) {
        // Escaped, parameter-free LIKE pattern (no replacements threading needed).
        const likePattern = sequelize.escape(`%${normFilter}%`);
        // SQL-side normaliser mirrors normaliseVisaName(): lower + strip non-alnum.
        const norm = (col) => `regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g')`;
        andConditions.push(
          sequelize.literal(
            `(
              EXISTS (
                SELECT 1 FROM candidate_applications ca
                WHERE ca."userId" = "User".id
                  AND ca."visaType" IS NOT NULL
                  AND ${norm('ca."visaType"')} LIKE ${likePattern}
              )
              OR EXISTS (
                SELECT 1 FROM cases c
                JOIN visa_types vt ON vt.id = c."visaTypeId"
                WHERE c."candidateId" = "User".id
                  AND c.deleted_at IS NULL
                  AND ${norm('vt.name')} LIKE ${likePattern}
              )
            )`,
          ),
        );
      }
    }

    // Payment-status filter. Mirrors the frontend's per-case computation from
    // Case.totalAmount / Case.paidAmount: Paid (paid ≥ total > 0),
    // Partial (0 < paid < total), Outstanding (total > 0, paid = 0),
    // Waived (total = 0). A candidate matches if any of their (non-deleted)
    // cases falls in the selected bucket.
    if (paymentStatus) {
      const total = `COALESCE(c."totalAmount", 0)::numeric`;
      const paid = `COALESCE(c."paidAmount", 0)::numeric`;
      const bucketSql = {
        Paid: `${total} > 0 AND ${paid} >= ${total}`,
        Partial: `${total} > 0 AND ${paid} > 0 AND ${paid} < ${total}`,
        Outstanding: `${total} > 0 AND ${paid} = 0`,
        Waived: `${total} = 0`,
      }[paymentStatus];
      if (bucketSql) {
        andConditions.push(
          sequelize.literal(
            `EXISTS (
              SELECT 1 FROM cases c
              WHERE c."candidateId" = "User".id
                AND c.deleted_at IS NULL
                AND ${bucketSql}
            )`,
          ),
        );
      }
    }

    if (andConditions.length > 0) {
      whereClause[Op.and] = andConditions;
    }

    const includeClause = [
      { model: this.repository.tenantDb.Role, as: "role", attributes: ["id", "name"] },
      {
        model: this.repository.tenantDb.CandidateApplication,
        as: "application",
        required: false,
        attributes: [
          "id", "userId", "status", "submittedAt",
          "visaType", "visaEndDate",
          "dob", "nationality",
        ],
      },
      {
        model: this.repository.tenantDb.Case,
        as: "cases",
        required: false,
        attributes: ["id", "caseId", "status", "nationality", "visaTypeId", "totalAmount", "paidAmount", "sponsorId"],
        include: [
          {
            model: this.repository.tenantDb.VisaType,
            as: "visaType",
            required: false,
            attributes: ["id", "name"],
          },
          {
            // Assigned business/sponsor (Case.sponsorId → User), with company name.
            model: this.repository.tenantDb.User,
            as: "sponsor",
            required: false,
            attributes: ["id", "first_name", "last_name", "email"],
            include: [
              {
                model: this.repository.tenantDb.SponsorProfile,
                as: "sponsorProfile",
                required: false,
                attributes: ["companyName"],
              },
            ],
          },
        ],
      },
    ];

    const { count, rows: candidates } = await this.repository.findAndCountAll({
      where: whereClause,
      include: includeClause,
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: offset,
      distinct: true,
    });

    return {
      candidates,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum),
      }
    };
  }

  async getCandidateById(id) {
    const candidate = await this.repository.findById(id);
    if (!candidate) throw new Error("Candidate not found");
    return candidate;
  }

  async updateCandidate(id, data) {
    const candidate = await this.repository.findById(id);
    if (!candidate) throw new Error("Candidate not found");

    // Whitelist-based update: only CANDIDATE_UPDATABLE_FIELDS may be persisted.
    // Protected fields (role_id, organisation_id, status, password, verification
    // /2FA/OTP, etc.) are rejected; unknown fields are dropped.
    const { updateData, protectedAttempts, unknownFields } = partitionCandidateUpdate(data);

    if (protectedAttempts.length > 0) {
      logger.warn(
        { candidateId: id, fields: protectedAttempts },
        "Blocked attempt to modify protected candidate fields (mass-assignment)",
      );
      const err = new Error(`Cannot modify protected field(s): ${protectedAttempts.join(", ")}`);
      err.status = 400;
      throw err;
    }
    if (unknownFields.length > 0) {
      logger.warn(
        { candidateId: id, fields: unknownFields },
        "Rejected unknown field(s) on candidate update",
      );
    }

    const { email, country_code, mobile, application } = data;

    if (email && email !== candidate.email) {
      const exists = await this.repository.findByEmail(email, id);
      if (exists) throw new Error("Email already exists");
    }

    if ((country_code || mobile) && (country_code !== candidate.country_code || mobile !== candidate.mobile)) {
      const exists = await this.repository.findByMobile(country_code || candidate.country_code, mobile || candidate.mobile, id);
      if (exists) throw new Error("Mobile number already exists");
    }

    await this.repository.transaction(async (t) => {
      await candidate.update(updateData, { transaction: t });

      if (application && typeof application === "object") {
        const existingApp = await this.repository.findApplicationByUserId(id, t);
        if (existingApp) {
          await this.repository.updateApplication(
            existingApp,
            sanitizeApplicationPayload(application),
            t,
          );
        } else {
          await this.repository.createApplication(
            { userId: id, ...sanitizeApplicationPayload(application) },
            t,
          );
        }

        // Sync Case logic
        const existingCase = await this.repository.findCaseByCandidateId(id, t);
        let visaTypeId = null;
        if (application.visaType) {
          const vt = await this.repository.findVisaTypeByName(application.visaType, t);
          if (vt) visaTypeId = vt.id;
        }

        if (existingCase) {
          await this.repository.updateCase(existingCase, {
            visaTypeId: visaTypeId || existingCase.visaTypeId,
            nationality: application.nationality || existingCase.nationality,
          }, t);
        }
      }
    });

    return await this.repository.findById(id);
  }

  /**
   * Reset a candidate's password securely.
   *
   * - Hashes with bcrypt (cost 12); a raw password is never persisted.
   * - Runs inside a tenant DB transaction. The platform User row (the source of
   *   truth for authentication) is updated *within* the transaction, so if the
   *   platform sync fails the tenant password update is rolled back — the two
   *   stores never diverge on a partial failure.
   *
   * @param {number|string} id - candidate (tenant user) id
   * @param {string} newPassword - already-validated strong password
   * @returns {Promise<boolean>}
   */
  async resetCandidatePassword(id, newPassword) {
    if (!newPassword || typeof newPassword !== 'string') {
      throw new Error('A new password is required');
    }

    const candidate = await this.repository.findById(id);
    if (!candidate) throw new Error('Candidate not found');

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.repository.transaction(async (t) => {
      // 1. Tenant user
      await candidate.update({ password: hashedPassword }, { transaction: t });

      // 2. Platform user (auth source of truth). If this throws, the tenant
      //    transaction above rolls back. timeoutMs=0 -> await the update fully.
      await syncUserToPlatformOnly(candidate.id, { password: hashedPassword }, 0);
    });

    return true;
  }

  async deleteCandidate(id) {
    const candidate = await this.repository.findById(id);
    if (!candidate) throw new Error("Candidate not found");
    await candidate.update({ status: "inactive" });
    return true;
  }

  async getCandidateApplication(userId) {
    const candidate = await this.repository.findById(userId);
    if (!candidate) throw new Error("Candidate not found");
    
    const application = await this.repository.findApplicationByUserId(userId);
    return application || null;
  }
  async updateCandidateApplication(userId, applicationData, performedByUser = null, context = null) {
    const candidate = await this.repository.findById(userId);
    if (!candidate) throw new Error("Candidate not found");

    const existingApp = await this.repository.findApplicationByUserId(userId);

    const { userPatch, applicationPatch, caseworkerId } =
      splitApplicationUpdatePayload(applicationData);
    const sanitizedApplication = sanitizeApplicationPayload(applicationPatch);

    if (userPatch.email && userPatch.email !== candidate.email) {
      const exists = await this.repository.findByEmail(userPatch.email, userId);
      if (exists) throw new Error("Email already exists");
    }

    const cc = userPatch.country_code ?? candidate.country_code;
    const mob = userPatch.mobile ?? candidate.mobile;
    if (
      (userPatch.country_code !== undefined || userPatch.mobile !== undefined) &&
      (cc !== candidate.country_code || mob !== candidate.mobile)
    ) {
      const exists = await this.repository.findByMobile(cc, mob, userId);
      if (exists) throw new Error("Mobile number already exists");
    }

    // Map labels for changes
    const fieldLabels = {
      first_name: "First Name",
      last_name: "Last Name",
      email: "Email",
      country_code: "Country Code",
      mobile: "Mobile Number",
      dob: "Date of Birth",
      nationality: "Nationality",
      passportNumber: "Passport Number",
      visaType: "Visa Type",
      visaEndDate: "Visa End Date",
      address: "Address",
      relationshipStatus: "Relationship Status",
      gender: "Gender",
      brpNumber: "BRP Number",
      niNumber: "National Insurance Number",
      issuingAuthority: "Passport Issuing Authority",
      issueDate: "Passport Issue Date",
      expiryDate: "Passport Expiry Date",
      contactNumber: "Contact Number",
      contactNumber2: "Secondary Contact Number",
      previousFullAddress: "Previous Full Address",
      previousAddress: "Previous Address",
      startDate: "Start Date",
      endDate: "End Date",
      birthCountry: "Country of Birth",
      placeOfBirth: "Place of Birth",
      passportAvailable: "Passport Available",
      nationalIdCardNumber: "National ID Card Number",
      nationalIdNumber: "National ID Number",
      idIssuingAuthorityCard: "ID Card Issuing Authority",
      idIssuingAuthorityNational: "National ID Issuing Authority",
      otherNationality: "Other Nationality",
      ukLicense: "UK License",
      medicalTreatment: "Medical Treatment Details",
      ukStayDuration: "Duration of stay in the UK",
      parentName: "Parent Name",
      parentRelation: "Parent Relation",
      parentDob: "Parent Date of Birth",
      parentNationality: "Parent Nationality",
      sameNationality: "Same Nationality as Parent",
      parent2Name: "Second Parent Name",
      parent2Relation: "Second Parent Relation",
      parent2Dob: "Second Parent Date of Birth",
      parent2Nationality: "Second Parent Nationality",
      parent2SameNationality: "Second Parent Same Nationality",
      illegalEntry: "Illegal Entry",
      overstayed: "Overstayed",
      breach: "Breach of Conditions",
      falseInfo: "False Information Provided",
      otherBreach: "Other Breach of Conditions",
      refusedVisa: "Visa Refusal",
      refusedEntry: "Entry Refusal",
      refusedPermission: "Permission Refusal",
      refusedAsylum: "Asylum Refusal",
      deported: "Deported",
      removed: "Removed",
      requiredToLeave: "Required to Leave",
      banned: "Banned",
      visitedOther: "Visited Other Countries",
      countryVisited: "Countries Visited",
      visitReason: "Visit Reason",
      entryDate: "Visit Entry Date",
      leaveDate: "Visit Leave Date",
      sponsored: "Sponsored Case",
      englishProof: "English Proof Type",
    };

    const normalizeValue = (val) => {
      if (val === null || val === undefined) return "";
      if (val instanceof Date) {
        return val.toISOString().split('T')[0];
      }
      if (typeof val === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
          return val.split('T')[0];
        }
        return val.trim();
      }
      return String(val).trim();
    };

    const isDifferent = (val1, val2) => {
      return normalizeValue(val1) !== normalizeValue(val2);
    };

    // Calculate changes
    const changes = [];
    
    // 1. Check User profile changes
    for (const key of Object.keys(userPatch)) {
      if (isDifferent(candidate[key], userPatch[key])) {
        const label = fieldLabels[key] || key;
        const oldVal = normalizeValue(candidate[key]) || "None";
        const newVal = normalizeValue(userPatch[key]) || "None";
        changes.push(`${label}: "${oldVal}" ➔ "${newVal}"`);
      }
    }

    // 2. Check CandidateApplication changes
    for (const key of Object.keys(sanitizedApplication)) {
      if (key === 'customResponses') continue;
      const label = fieldLabels[key] || key;
      const oldVal = existingApp ? normalizeValue(existingApp[key]) : "";
      const newVal = normalizeValue(sanitizedApplication[key]);
      
      if (isDifferent(oldVal, newVal)) {
        const oldDisplay = oldVal || "None";
        const newDisplay = newVal || "None";
        changes.push(`${label}: "${oldDisplay}" ➔ "${newDisplay}"`);
      }
    }

    // Attribute audit/timeline writes from the afterUpdate hook to the real actor
    // (falls back to null inside the hook if the id isn't a user in this tenant DB).
    const performedById = Number(performedByUser?.userId ?? performedByUser?.id) || null;
    const hookOptions = {
      performedBy: performedById,
      role: performedByUser?.role?.name || performedByUser?.role || 'admin',
      organisationId: candidate.organisation_id ?? null,
    };

    await this.repository.transaction(async (t) => {
      if (Object.keys(userPatch).length > 0) {
        await candidate.update(userPatch, { transaction: t, ...hookOptions });
      }

      let app = await this.repository.findApplicationByUserId(userId, t);

      if (app) {
        await this.repository.updateApplication(app, sanitizedApplication, t, hookOptions);
      } else {
        app = await this.repository.createApplication(
          {
            userId,
            ...sanitizedApplication,
            organisation_id: candidate.organisation_id,
          },
          t,
        );
      }

      const existingCase = await this.repository.findCaseByCandidateId(userId, t);
      let visaTypeId = existingCase?.visaTypeId ?? null;
      const visaName = sanitizedApplication.visaType;
      if (visaName) {
        const vt = await this.repository.findVisaTypeByName(visaName, t);
        if (vt) visaTypeId = vt.id;
      }

      const casePatch = {};
      if (visaTypeId != null) casePatch.visaTypeId = visaTypeId;
      if (sanitizedApplication.nationality !== undefined) {
        casePatch.nationality = sanitizedApplication.nationality;
      }
      if (caseworkerId != null && caseworkerId !== '') {
        const cwId = Number(caseworkerId);
        if (Number.isFinite(cwId)) {
          casePatch.assignedcaseworkerId = [cwId];
        }
      }

      if (existingCase && Object.keys(casePatch).length > 0) {
        await this.repository.updateCase(existingCase, casePatch, t);
      }
    });

    if (Object.keys(userPatch).length > 0) {
      syncUserToPlatformOnly(userId, userPatch).catch((err) => {
        logger.error({ err }, 'Platform user sync after client update');
      });
    }

    // Publish event for timeline audit log and notifications after successful transaction
    if (changes.length > 0) {
      try {
        const existingCase = await this.repository.findCaseByCandidateId(userId);
        if (existingCase) {
          const description = `Application form updated. Changed fields:\n${changes.join('\n')}`;
          
          if (context) {
            // Using central event bus (Phase 8/13 Integration)
            eventPublisher.publish(EVENTS.PROFILE_UPDATED, {
              entityId: existingCase.id,
              entityType: 'case',
              candidateId: userId,
              assignedCaseworkerId: existingCase.assignedcaseworkerId,
              performedById: performedByUser?.id || null,
              performedByRole: performedByUser?.role?.name || performedByUser?.role || 'candidate',
              description,
              actionType: 'case_updated'
            }, context);
          } else {
            // Fallback if context is not provided
            await recordTimelineEntry({
              tenantDb: this.repository.tenantDb,
              caseId: existingCase.id,
              actionType: 'case_updated',
              description,
              performedBy: performedByUser?.id || null,
              visibility: 'public',
            });
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to record application update event');
      }
    }

    await candidate.reload({
      include: [
        {
          model: this.repository.tenantDb.Role,
          as: 'role',
          attributes: ['id', 'name'],
        },
        {
          model: this.repository.tenantDb.CandidateApplication,
          as: 'application',
          required: false,
        },
        {
          model: this.repository.tenantDb.Case,
          as: 'cases',
          required: false,
          attributes: ['id', 'caseId', 'status', 'caseStage', 'nationality', 'visaTypeId'],
        },
      ],
    });

    return candidate;
  }

  /**
   * Assign (or unassign) a candidate to a business/sponsor.
   *
   * The business panel resolves its candidates via Case.sponsorId
   * (see Sponsor/Workers getSponsoredWorkers), so assigning sets the
   * candidate's case.sponsorId to the chosen sponsor user. Passing
   * businessId = null clears the assignment.
   *
   * @param {number} candidateId
   * @param {number|null} businessId - sponsor (role 4) user id, or null to unassign
   * @param {object} [context] - { organisationId } for notifications
   */
  async assignBusiness(candidateId, businessId, context = {}) {
    const tenantDb = this.repository.tenantDb;

    const candidate = await tenantDb.User.findOne({
      where: { id: candidateId, role_id: ROLES.CANDIDATE },
      attributes: ['id', 'first_name', 'last_name', 'email', 'organisation_id'],
    });
    if (!candidate) {
      const err = new Error('Candidate not found');
      err.status = 404;
      throw err;
    }

    let business = null;
    if (businessId != null) {
      business = await tenantDb.User.findOne({
        where: { id: businessId, role_id: ROLES.BUSINESS },
        attributes: ['id', 'first_name', 'last_name', 'email', 'status'],
        include: [
          {
            model: tenantDb.SponsorProfile,
            as: 'sponsorProfile',
            required: false,
            attributes: ['companyName'],
          },
        ],
      });
      if (!business) {
        const err = new Error('Business (sponsor) not found');
        err.status = 404;
        throw err;
      }
      if (business.status !== 'active') {
        const err = new Error('Cannot assign to an inactive business');
        err.status = 400;
        throw err;
      }
    }

    // Ensure the candidate has a case to carry the assignment.
    let caseRecord = await this.repository.findCaseByCandidateId(candidateId);
    if (!caseRecord) {
      if (businessId == null) {
        // Nothing to unassign from — return a no-op result.
        return { candidateId, businessId: null, caseId: null };
      }
      caseRecord = await ensureCandidateEnquiryCase(tenantDb, candidateId, {
        organisationId: context.organisationId ?? candidate.organisation_id ?? null,
      });
    }

    await caseRecord.update({ sponsorId: businessId });

    // Notify the business that a candidate was assigned to them.
    if (business) {
      const companyName = business.sponsorProfile?.companyName || 'your business';
      notifyUser(tenantDb, business.id, {
        type: 'info',
        priority: 'medium',
        category: 'case',
        title: 'Candidate Assigned',
        message: `${candidate.first_name} ${candidate.last_name} has been assigned to ${companyName}.`,
        actionType: 'candidate_assigned',
        entityType: 'user',
        entityId: candidate.id,
        organisationId: context.organisationId ?? candidate.organisation_id ?? null,
      }).catch((err) => logger.error({ err }, 'assignBusiness notify failed'));
    }

    return {
      candidateId,
      businessId,
      caseId: caseRecord.id,
      business: business
        ? {
            id: business.id,
            name: `${business.first_name} ${business.last_name}`.trim(),
            companyName: business.sponsorProfile?.companyName || null,
          }
        : null,
    };
  }
}
