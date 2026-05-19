import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { CandidateRepository } from './candidate.repository.js';
import { generateStrongPassword } from '../../../utils/passwordGenerator.js';
import { notifyUserCreated } from '../../../services/notification.service.js';
import { ROLES } from '../../../middlewares/role.middleware.js';
import { createUserOnPlatformAndTenant } from '../../../services/userSync.service.js';
import { sendCandidateWelcomeEmail } from '../../../services/candidateMail.service.js';
import { ensureCandidateEnquiryCase } from '../../../services/candidateOnboarding.service.js';
import { DEFAULT_CASE_STAGE } from '../../../constants/immigrationCaseProcess.js';

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
          ...application,
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

    if (!application) {
      await ensureCandidateEnquiryCase(this.repository.tenantDb, candidate.id, {
        visaTypeName: application?.visaType || null,
        organisationId: organisation_id,
      });
    }

    if (!password) {
      sendCandidateWelcomeEmail({
        user: candidate,
        plainPassword: generatedPassword,
        organisationId: organisation_id,
      }).catch((err) => console.error("Candidate welcome email:", err));
    }

    // Background notification
    notifyUserCreated(this.repository.tenantDb, ROLES.ADMIN, {
      id: candidate.id,
      email: candidate.email,
      role: "candidate",
      first_name: candidate.first_name,
      last_name: candidate.last_name,
    }).catch(err => console.error("Notification Error:", err));

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
      { model: this.repository.tenantDb.CandidateApplication, as: "application", required: false, attributes: ["id", "userId", "status", "submittedAt", "visaType"] },
    ];

    // TODO: Add complex Case filtering logic here if needed

    const { count, rows: candidates } = await this.repository.findAndCountAll({
      where: whereClause,
      include: includeClause,
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: offset,
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
          await this.repository.updateApplication(existingApp, application, t);
        } else {
          await this.repository.createApplication({ userId: id, ...application }, t);
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
}
