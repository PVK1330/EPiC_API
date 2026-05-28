import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { CandidateRepository } from './candidate.repository.js';
import { generateStrongPassword } from '../../../utils/passwordGenerator.js';
import { notifyUserCreated } from '../../../services/notification.service.js';
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

export class CandidateService {
  constructor(tenantDb) {
    this.repository = new CandidateRepository(tenantDb);
  }

  async createCandidate(data) {
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

    // Background notification
    notifyUserCreated(this.repository.tenantDb, ROLES.ADMIN, {
      id: candidate.id,
      email: candidate.email,
      role: "candidate",
      first_name: candidate.first_name,
      last_name: candidate.last_name,
    }).catch(err => logger.error({ err }, "Notification Error"));

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

    const whereClause = { role_id: ROLES.CANDIDATE };
    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
      ];
    }
    if (status) whereClause.status = status;

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
        attributes: ["id", "caseId", "status", "nationality", "visaTypeId", "totalAmount", "paidAmount"],
        include: [
          {
            model: this.repository.tenantDb.VisaType,
            as: "visaType",
            required: false,
            attributes: ["id", "name"],
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

    const { email, country_code, mobile, application, ...updateData } = data;

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
  async updateCandidateApplication(userId, applicationData, performedBy = null) {
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

    await this.repository.transaction(async (t) => {
      if (Object.keys(userPatch).length > 0) {
        await candidate.update(userPatch, { transaction: t });
      }

      let app = await this.repository.findApplicationByUserId(userId, t);

      if (app) {
        await this.repository.updateApplication(app, sanitizedApplication, t);
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

    // Write timeline audit log after successful transaction
    if (changes.length > 0) {
      try {
        const existingCase = await this.repository.findCaseByCandidateId(userId);
        if (existingCase) {
          const description = `Application form updated. Changed fields:\n${changes.join('\n')}`;
          await recordTimelineEntry({
            tenantDb: this.repository.tenantDb,
            caseId: existingCase.id,
            actionType: 'case_updated',
            description,
            performedBy: performedBy || null,
            visibility: 'public',
          });
        }
      } catch (err) {
        logger.error({ err }, 'Failed to record application update timeline entry');
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
}
