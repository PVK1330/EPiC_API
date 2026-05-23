import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { ROLES } from '../../../middlewares/role.middleware.js';
import { generateStrongPassword } from '../../../utils/passwordGenerator.js';
import { createUserOnPlatformAndTenant } from '../../../services/userSync.service.js';
import { sendTenantCaseworkerWelcomeEmail } from '../../../services/tenantUserMail.service.js';
import platformDb from '../../../models/index.js';
import { isPlatformEmailTaken, normalizePlatformEmail } from '../../../utils/platformUserEmail.js';
import {
  applyOrganisationScope,
  mergeCaseWhere,
  mergeUserWhere,
  organisationIdFromRequest,
  userBelongsToOrganisation,
} from '../../../utils/tenantScope.js';

const CASEWORKER_ROLE = ROLES.CASEWORKER;

// Multer configuration for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Get All Departments
export const getDepartments = async (req, res) => {
  try {
    const departments = await req.tenantDb.Department.findAll({
      where: applyOrganisationScope({ is_active: true }, organisationIdFromRequest(req)),
      order: [['name', 'ASC']],
      attributes: ['name'],
      raw: true
    });

    const departmentList = departments
      .map(d => d.name)
      .filter(d => d && d.trim() !== '')
      .sort();

    res.status(200).json({
      status: "success",
      message: "Departments retrieved successfully",
      data: {
        departments: departmentList
      }
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch departments",
      error: error.message
    });
  }
};

// Create Department
export const createDepartment = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Department name is required"
      });
    }

    const trimmedName = name.trim();

    // Check if department already exists
    const existing = await req.tenantDb.Department.findOne({
      where: { name: trimmedName }
    });

    if (existing) {
      return res.status(400).json({
        status: "error",
        message: "Department already exists"
      });
    }

    // Create the department
    const department = await req.tenantDb.Department.create({
      name: trimmedName,
      is_active: true
    });

    res.status(201).json({
      status: "success",
      message: "Department created successfully",
      data: {
        department: trimmedName
      }
    });
  } catch (error) {
    console.error("Error creating department:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to create department",
      error: error.message
    });
  }
};
//department dropdown api
export const departmentDropdown = async (req, res) => {
  try {
    const departments = await req.tenantDb.Department.findAll({
      where: { is_active: true },
      order: [['name', 'ASC']],
      attributes: ['id', 'name'],
      raw: true
    });

    const departmentList = departments
      .filter(d => d.name && d.name.trim() !== '');

    res.status(200).json({
      status: "success",
      message: "Departments retrieved successfully",
      data: {
        departments: departmentList
      }
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch departments",
      error: error.message
    });
  }
};
// Update Department
export const updateDepartment = async (req, res) => {
  try {
    const { oldName, newName } = req.body;

    if (!oldName || !newName || !oldName.trim() || !newName.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Old name and new name are required"
      });
    }

    if (oldName.trim() === newName.trim()) {
      return res.status(400).json({
        status: "error",
        message: "New name must be different from old name"
      });
    }

    // Find the department by old name
    const department = await req.tenantDb.Department.findOne({
      where: { name: oldName.trim() }
    });

    if (!department) {
      return res.status(404).json({
        status: "error",
        message: "Department not found"
      });
    }

    // Update the department name
    await department.update({ name: newName.trim() });

    // Update all caseworker profiles with the old department name
    const updated = await req.tenantDb.CaseworkerProfile.update(
      { department: newName.trim() },
      { where: { department: oldName.trim() } }
    );

    res.status(200).json({
      status: "success",
      message: "Department updated successfully",
      data: {
        oldName: oldName.trim(),
        newName: newName.trim(),
        affectedCaseworkers: updated[0]
      }
    });
  } catch (error) {
    console.error("Error updating department:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to update department",
      error: error.message
    });
  }
};

// Delete Department
export const deleteDepartment = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Department name is required"
      });
    }

    // Check if any caseworkers have this department
    const count = await req.tenantDb.CaseworkerProfile.count({
      where: { department: name.trim() }
    });

    if (count > 0) {
      return res.status(400).json({
        status: "error",
        message: `Cannot delete department. ${count} caseworker(s) are assigned to this department.`
      });
    }

    // Find the department
    const department = await req.tenantDb.Department.findOne({
      where: { name: name.trim() }
    });

    if (!department) {
      return res.status(404).json({
        status: "error",
        message: "Department not found"
      });
    }

    // Delete the department (soft delete by setting is_active to false)
    await department.update({ is_active: false });

    res.status(200).json({
      status: "success",
      message: "Department deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting department:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to delete department",
      error: error.message
    });
  }
};

export const uploadMiddleware = upload.single('file');

const PROFILE_KEYS = [
  "employee_id",
  "job_title",
  "department",
  "region",
  "timezone",
  "date_of_joining",
  "emergency_contact_name",
  "emergency_contact_phone",
  "notes",
];

function pickProfileFields(body) {
  const out = {};
  for (const key of PROFILE_KEYS) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== "") {
      out[key] = body[key];
    }
  }
  return out;
}

function caseworkerInclude(req) {
  return [
    {
      model: req.tenantDb.Role,
      as: 'role',
      attributes: ["id", "name"],
    },
    {
      model: req.tenantDb.CaseworkerProfile,
      as: "caseworkerProfile",
      required: false,
    },
  ];
}

function parseAssignedCaseworkerIds(caseRecord) {
  const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === "object" && raw !== null) {
    const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
    if (Array.isArray(ids)) {
      return ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

function caseAssignedToCaseworker(caseRecord, caseworkerId) {
  return parseAssignedCaseworkerIds(caseRecord).includes(Number(caseworkerId));
}

function extractAssignedCandidates(cases = []) {
  const byId = new Map();
  for (const c of cases) {
    const row = c?.toJSON ? c.toJSON() : c;
    const cand = row.candidate;
    if (!cand?.id) continue;
    if (!byId.has(cand.id)) {
      byId.set(cand.id, {
        id: cand.id,
        first_name: cand.first_name,
        last_name: cand.last_name,
        email: cand.email,
        caseCount: 1,
      });
    } else {
      byId.get(cand.id).caseCount += 1;
    }
  }
  return [...byId.values()].sort((a, b) => {
    const an = `${a.last_name || ""} ${a.first_name || ""}`.trim().toLowerCase();
    const bn = `${b.last_name || ""} ${b.first_name || ""}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });
}

async function loadOrganisationCases(req, extraWhere = {}) {
  return req.tenantDb.Case.findAll({
    where: mergeCaseWhere(req, { deleted_at: null, ...extraWhere }),
    attributes: [
      "id",
      "caseId",
      "status",
      "caseStage",
      "targetSubmissionDate",
      "assignedcaseworkerId",
      "candidateId",
      "visaTypeId",
      "organisation_id",
    ],
    include: [
      {
        model: req.tenantDb.User,
        as: "candidate",
        attributes: ["id", "first_name", "last_name", "email"],
        required: false,
      },
      {
        model: req.tenantDb.VisaType,
        as: "visaType",
        attributes: ["id", "name"],
        required: false,
      },
    ],
    order: [["updated_at", "DESC"]],
  });
}

function computeCaseMetrics(cases = []) {
  const now = new Date();
  const finishedStatuses = new Set(["Completed", "Approved", "Closed", "Cancelled"]);
  const completedStatuses = new Set(["Completed", "Approved", "Closed"]);
  const inProgressStatuses = new Set(["In Progress", "Drafting", "Under Review", "Submitted"]);
  const pendingStatuses = new Set(["Pending", "Docs Pending", "Lead"]);

  const totalCases = cases.length;
  const completedCases = cases.filter((c) => completedStatuses.has(c.status)).length;
  const inProgressCases = cases.filter((c) => inProgressStatuses.has(c.status)).length;
  const pendingCases = cases.filter((c) => pendingStatuses.has(c.status)).length;
  const overdueCases = cases.filter((c) => {
    const isNotFinished = !finishedStatuses.has(c.status);
    const target = c.targetSubmissionDate ? new Date(c.targetSubmissionDate) : null;
    return isNotFinished && target && target < now;
  }).length;

  const completionRate =
    totalCases > 0 ? Number(((completedCases / totalCases) * 100).toFixed(1)) : 0;

  return {
    totalCases,
    completedCases,
    inProgressCases,
    pendingCases,
    overdueCases,
    completionRate,
  };
}

function mapCaseForCaseworkerDetail(caseRow, now = new Date()) {
  const plain = caseRow?.toJSON ? caseRow.toJSON() : caseRow;
  const finishedStatuses = new Set(["Completed", "Approved", "Closed", "Cancelled"]);
  const completedStatuses = new Set(["Completed", "Approved", "Closed"]);
  const target = plain.targetSubmissionDate ? new Date(plain.targetSubmissionDate) : null;
  const isOverdue =
    !finishedStatuses.has(plain.status) && target && target < now;

  const candidate = plain.candidate
    ? {
        id: plain.candidate.id,
        first_name: plain.candidate.first_name,
        last_name: plain.candidate.last_name,
        email: plain.candidate.email,
      }
    : null;

  const visaType = plain.visaType
    ? { id: plain.visaType.id, name: plain.visaType.name }
    : null;

  return {
    id: plain.id,
    caseId: plain.caseId,
    status: plain.status,
    caseStage: plain.caseStage,
    targetSubmissionDate: plain.targetSubmissionDate,
    isOverdue,
    isCompleted: completedStatuses.has(plain.status),
    candidate,
    visaType,
  };
}

// Create Caseworker
export const createCaseworker = async (req, res) => {
  const t = await req.tenantDb.sequelize.transaction();
  let committed = false;
  try {
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      password,
      confirm_password,
    } = req.body;

    let role_id = req.body.role_id;
    if (role_id === undefined || role_id === null || role_id === "") {
      role_id = CASEWORKER_ROLE;
    } else {
      role_id = parseInt(role_id, 10);
    }

    const profileInput = pickProfileFields(req.body);

    if (!first_name || !last_name || !email || !country_code || !mobile) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "First name, last name, email, country code, and mobile are required",
        data: null,
      });
    }

    if (Number.isNaN(role_id) || role_id !== CASEWORKER_ROLE) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "role_id must be the caseworker role",
        data: null,
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Invalid email format",
        data: null,
      });
    }

    if (password && !confirm_password) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "confirm_password is required when password is set",
        data: null,
      });
    }

    if (password && confirm_password && password !== confirm_password) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Password and confirm password do not match",
        data: null,
      });
    }

    if (password && password.length < 8) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters",
        data: null,
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const organisationId = req.user?.organisation_id;
    if (!organisationId) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Organisation context is required",
        data: null,
      });
    }

    if (await isPlatformEmailTaken(platformDb, emailNorm, organisationId)) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Email already exists for this organisation",
        data: null,
      });
    }

    const existingMobile = await req.tenantDb.User.findOne({
      where: { country_code, mobile },
      transaction: t,
    });
    if (existingMobile) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Mobile number already exists",
        data: null,
      });
    }

    const role = await req.tenantDb.Role.findByPk(role_id, { transaction: t });
    if (!role) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Invalid role ID",
        data: null,
      });
    }

    if (profileInput.employee_id) {
      const empTaken = await req.tenantDb.CaseworkerProfile.findOne({
        where: { employee_id: profileInput.employee_id },
        transaction: t,
      });
      if (empTaken) {
        await t.rollback();
        return res.status(400).json({
          status: "error",
          message: "Employee ID already in use",
          data: null,
        });
      }
    }

    let generatedPassword = password;
    if (!password) {
      generatedPassword = generateStrongPassword(12);
    }

    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const caseworker = await createUserOnPlatformAndTenant(req.tenantDb, {
      first_name,
      last_name,
      email: emailNorm,
      country_code,
      mobile,
      role_id: CASEWORKER_ROLE,
      password: hashedPassword,
      is_email_verified: true,
      is_otp_verified: true,
      status: "active",
      temp_password: 'pending_reset',
      organisation_id: organisationId,
    });

    await req.tenantDb.CaseworkerProfile.create(
      {
        user_id: caseworker.id,
        ...profileInput,
      },
      { transaction: t }
    );

    await t.commit();
    committed = true;

    let emailResult = { sent: false, skipped: true };
    try {
      emailResult = await sendTenantCaseworkerWelcomeEmail({
        user: caseworker,
        plainPassword: generatedPassword,
        organisationId,
        firstName: first_name,
      });
    } catch (emailError) {
      console.error("Failed to send caseworker email:", emailError);
    }

    const full = await req.tenantDb.User.findOne({
      where: { id: caseworker.id },
      attributes: {
        exclude: [
          "password",
          "otp_code",
          "otp_expiry",
          "password_reset_otp",
          "password_reset_otp_expiry",
          "temp_password",
        ],
      },
      include: caseworkerInclude(req),
    });

    const { password: _, ...caseworkerData } = caseworker.toJSON();

    res.status(201).json({
      status: "success",
      message: "Caseworker created successfully",
      data: {
        caseworker: full || caseworkerData,
        temporary_password: !password && !emailResult.sent ? generatedPassword : null,
        email_sent: emailResult.sent === true,
        login_url: emailResult.loginUrl,
      },
    });
  } catch (error) {
    if (!committed) {
      try {
        await t.rollback();
      } catch (_) {
        /* already rolled back */
      }
    }
    console.error("Create Caseworker Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get All Caseworkers
export const getAllCaseworkers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, department } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    let userFilters = { role_id: CASEWORKER_ROLE };
    if (status) userFilters.status = status;
    if (search) {
      userFilters = {
        [Op.and]: [
          userFilters,
          {
            [Op.or]: [
              { first_name: { [Op.iLike]: `%${search}%` } },
              { last_name: { [Op.iLike]: `%${search}%` } },
              { email: { [Op.iLike]: `%${search}%` } },
              { mobile: { [Op.iLike]: `%${search}%` } },
            ],
          },
        ],
      };
    }
    const whereClause = mergeUserWhere(req, userFilters);

    // Build include clause for filtering by department
    const includeClause = caseworkerInclude(req);
    
    if (department) {
      includeClause[1].where = { department: { [Op.like]: `%${department}%` } };
      includeClause[1].required = true;
    }

    const { count, rows: caseworkers } = await req.tenantDb.User.findAndCountAll({
      where: whereClause,
      attributes: {
        exclude: [
          "password",
          "otp_code",
          "otp_expiry",
          "password_reset_otp",
          "password_reset_otp_expiry",
          "temp_password",
        ],
      },
      include: includeClause,
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: offset,
      distinct: true,
      subQuery: false,
    });

    const orgId = organisationIdFromRequest(req);
    const allCases = await loadOrganisationCases(req);

    const caseworkersWithMetrics = caseworkers.map((caseworker) => {
      const assignedCases = allCases.filter((c) =>
        caseAssignedToCaseworker(c, caseworker.id),
      );

      const now = new Date();
      const totalCases = assignedCases.length;
      
      const completedCases = assignedCases.filter(c => 
        ['Completed', 'Approved', 'Closed'].includes(c.status)
      ).length;

      const overdueCases = assignedCases.filter(c => {
        // A case is overdue if it's not completed/closed and the deadline has passed
        const isNotFinished = !['Completed', 'Approved', 'Closed', 'Cancelled'].includes(c.status);
        const isPastDeadline = c.targetSubmissionDate && new Date(c.targetSubmissionDate) < now;
        return isNotFinished && isPastDeadline;
      }).length;

      const inProgressCases = assignedCases.filter(c => 
        ['In Progress', 'Drafting', 'Under Review', 'Submitted'].includes(c.status)
      ).length;

      const pendingCases = assignedCases.filter(c => 
        ['Pending', 'Docs Pending', 'Lead'].includes(c.status)
      ).length;

      const caseworkerData = caseworker.toJSON();
      const assignedCandidates = extractAssignedCandidates(assignedCases);
      caseworkerData.performance = {
        totalCases,
        completedCases,
        inProgressCases,
        pendingCases,
        overdueCases,
        assignedCandidates: assignedCandidates.length,
        completionRate: totalCases > 0 ? ((completedCases / totalCases) * 100).toFixed(1) : 0,
      };

      return caseworkerData;
    });

    res.status(200).json({
      status: "success",
      message: "Caseworkers retrieved successfully",
      data: {
        organisationId: orgId,
        caseworkers: caseworkersWithMetrics,
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(count / limitNum),
        },
      },
    });
  } catch (error) {
    console.error("Get All Caseworkers Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get Caseworker by ID
export const getCaseworkerById = async (req, res) => {
  try {
    const caseworkerId = parseInt(req.params.id, 10);
    if (Number.isNaN(caseworkerId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid caseworker id",
        data: null,
      });
    }

    const orgId = organisationIdFromRequest(req);

    const caseworker = await req.tenantDb.User.findOne({
      where: mergeUserWhere(req, { id: caseworkerId, role_id: CASEWORKER_ROLE }),
      attributes: {
        exclude: [
          "password",
          "otp_code",
          "otp_expiry",
          "password_reset_otp",
          "password_reset_otp_expiry",
          "temp_password",
        ],
      },
      include: caseworkerInclude(req),
    });

    if (!caseworker || !userBelongsToOrganisation(caseworker, orgId)) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    const allActiveCases = await loadOrganisationCases(req);

    const assignedCases = allActiveCases.filter((c) =>
      caseAssignedToCaseworker(c, caseworkerId),
    );

    const now = new Date();
    const cases = assignedCases.map((c) => mapCaseForCaseworkerDetail(c, now));
    const candidates = extractAssignedCandidates(assignedCases);
    const metrics = {
      ...computeCaseMetrics(assignedCases),
      assignedCandidates: candidates.length,
    };

    const caseworkerJson = caseworker.toJSON();
    caseworkerJson.performance = metrics;

    res.status(200).json({
      status: "success",
      message: "Caseworker retrieved successfully",
      data: {
        organisationId: orgId,
        caseworker: caseworkerJson,
        metrics,
        candidates,
        cases,
      },
    });
  } catch (error) {
    console.error("Get Caseworker by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update Caseworker
export const updateCaseworker = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id,
      status,
    } = req.body;

    const profileInput = pickProfileFields(req.body);

    const caseworker = await req.tenantDb.User.findOne({
      where: { id, role_id: CASEWORKER_ROLE },
      include: [{ model: req.tenantDb.CaseworkerProfile, as: "caseworkerProfile", required: false }],
    });

    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    if (!first_name || !last_name || !email || !country_code || !mobile) {
      return res.status(400).json({
        status: "error",
        message: "First name, last name, email, country code, and mobile are required",
        data: null,
      });
    }

    if (role_id !== undefined && role_id !== CASEWORKER_ROLE) {
      return res.status(400).json({
        status: "error",
        message: "Cannot change caseworker to a different role via this endpoint",
        data: null,
      });
    }

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const emailNorm = normalizePlatformEmail(email);

    if (emailNorm !== normalizePlatformEmail(caseworker.email)) {
      if (organisationId && (await isPlatformEmailTaken(platformDb, emailNorm, organisationId))) {
        return res.status(400).json({
          status: "error",
          message: "Email already exists for this organisation",
          data: null,
        });
      }
      const existingEmail = await req.tenantDb.User.findOne({
        where: { email: emailNorm, id: { [Op.ne]: id } },
      });
      if (existingEmail) {
        return res.status(400).json({
          status: "error",
          message: "Email already exists",
          data: null,
        });
      }
    }

    if (country_code !== caseworker.country_code || mobile !== caseworker.mobile) {
      const existingMobile = await req.tenantDb.User.findOne({
        where: { country_code, mobile, id: { [Op.ne]: id } },
      });
      if (existingMobile) {
        return res.status(400).json({
          status: "error",
          message: "Mobile number already exists",
          data: null,
        });
      }
    }

    if (profileInput.employee_id) {
      const empTaken = await req.tenantDb.CaseworkerProfile.findOne({
        where: {
          employee_id: profileInput.employee_id,
          user_id: { [Op.ne]: caseworker.id },
        },
      });
      if (empTaken) {
        return res.status(400).json({
          status: "error",
          message: "Employee ID already in use",
          data: null,
        });
      }
    }

    await caseworker.update({
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      status: status !== undefined ? status : caseworker.status,
    });

    const profile = caseworker.caseworkerProfile;
    if (profile) {
      await profile.update(profileInput);
    } else if (Object.keys(profileInput).length > 0) {
      await req.tenantDb.CaseworkerProfile.create({
        user_id: caseworker.id,
        ...profileInput,
      });
    }

    const updatedCaseworker = await req.tenantDb.User.findOne({
      where: { id },
      attributes: {
        exclude: [
          "password",
          "otp_code",
          "otp_expiry",
          "password_reset_otp",
          "password_reset_otp_expiry",
          "temp_password",
        ],
      },
      include: caseworkerInclude(req),
    });

    res.status(200).json({
      status: "success",
      message: "Caseworker updated successfully",
      data: { caseworker: updatedCaseworker },
    });
  } catch (error) {
    console.error("Update Caseworker Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Delete Caseworker (Soft Delete)
export const deleteCaseworker = async (req, res) => {
  try {
    const { id } = req.params;

    const caseworker = await req.tenantDb.User.findOne({ where: { id, role_id: CASEWORKER_ROLE } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    await caseworker.update({ status: "inactive" });

    res.status(200).json({
      status: "success",
      message: "Caseworker deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete Caseworker Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Reset Caseworker Password
export const resetCaseworkerPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password, confirm_password } = req.body;

    if (!new_password || !confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "New password and confirm password are required",
        data: null,
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "Passwords do not match",
        data: null,
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters long",
        data: null,
      });
    }

    const caseworker = await req.tenantDb.User.findOne({ where: { id, role_id: CASEWORKER_ROLE } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);

    await caseworker.update({
      password: hashedPassword,
      temp_password: null,
      password_reset_otp: null,
      password_reset_otp_expiry: null,
    });

    res.status(200).json({
      status: "success",
      message: "Password reset successfully",
      data: null,
    });
  } catch (error) {
    console.error("Reset Caseworker Password Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Toggle Caseworker Status (Active/Inactive)
export const toggleCaseworkerStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const caseworker = await req.tenantDb.User.findOne({ where: { id, role_id: CASEWORKER_ROLE } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    const newStatus = caseworker.status === "active" ? "inactive" : "active";
    await caseworker.update({ status: newStatus });

    res.status(200).json({
      status: "success",
      message: `Caseworker ${newStatus === "active" ? "activated" : "deactivated"} successfully`,
      data: {
        caseworker_id: caseworker.id,
        status: newStatus,
      },
    });
  } catch (error) {
    console.error("Toggle Caseworker Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Export Caseworkers to CSV
export const exportCaseworkers = async (req, res) => {
  try {
    const { search, status, department } = req.query;

    const whereClause = {
      role_id: CASEWORKER_ROLE,
    };

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

    // Build include clause for filtering by department
    const includeClause = caseworkerInclude(req);
    
    if (department) {
      includeClause[1].where = { department: { [Op.like]: `%${department}%` } };
      includeClause[1].required = true;
    }

    const caseworkers = await req.tenantDb.User.findAll({
      where: whereClause,
      attributes: {
        exclude: [
          "password",
          "otp_code",
          "otp_expiry",
          "password_reset_otp",
          "password_reset_otp_expiry",
          "temp_password",
        ],
      },
      include: includeClause,
      order: [["createdAt", "DESC"]],
    });

    // Generate CSV
    const csvHeader = ['ID', 'First Name', 'Last Name', 'Email', 'Country Code', 'Mobile', 'Role', 'Department', 'Status', 'Created At'];
    const csvRows = caseworkers.map(caseworker => [
      caseworker.id,
      caseworker.first_name,
      caseworker.last_name,
      caseworker.email,
      caseworker.country_code,
      caseworker.mobile,
      caseworker.role?.name || 'N/A',
      caseworker.caseworkerProfile?.department || 'N/A',
      caseworker.status,
      caseworker.createdAt.toISOString()
    ]);

    const csvContent = [
      csvHeader.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="caseworkers_export.csv"');
    res.send(csvContent);

  } catch (error) {
    console.error("Export Caseworkers Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Bulk Import Caseworkers from CSV
export const bulkImportCaseworkers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: "error",
        message: "No file uploaded",
        data: null
      });
    }

    const csvData = req.file.buffer.toString('utf-8');
    const lines = csvData.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return res.status(400).json({
        status: "error",
        message: "CSV file is empty or has no data rows",
        data: null
      });
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const results = {
      success: [],
      errors: []
    };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const rowData = {};
        
        headers.forEach((header, index) => {
          rowData[header] = values[index] || '';
        });

        // Generate password
        const generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
        const hashedPassword = await bcrypt.hash(generatedPassword, 12);

        // Create caseworker
        const caseworker = await req.tenantDb.User.create({
          first_name: rowData.first_name || rowData.firstName || '',
          last_name: rowData.last_name || rowData.lastName || '',
          email: rowData.email,
          country_code: rowData.country_code || rowData.countryCode || '+44',
          mobile: rowData.mobile,
          role_id: CASEWORKER_ROLE,
          password: hashedPassword,
          is_email_verified: true,
          is_otp_verified: true,
          status: 'active'
        });

        // Create caseworker profile
        const profileData = {};
        PROFILE_KEYS.forEach(key => {
          const csvKey = key.replace(/_/g, ' ').toLowerCase();
          const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
          if (rowData[key] || rowData[csvKey] || rowData[camelKey]) {
            profileData[key] = rowData[key] || rowData[csvKey] || rowData[camelKey];
          }
        });

        await req.tenantDb.CaseworkerProfile.create({
          user_id: caseworker.id,
          ...profileData
        });

        // Send welcome email
        try {
          const loginUrl = process.env.FRONTEND_URL || "http://localhost:3000";
          await sendCaseworkerWelcomeEmail({
            to: caseworker.email,
            html: generateCaseworkerCredentialsTemplate(caseworker.email, generatedPassword, loginUrl),
          });
        } catch (emailError) {
          console.error("Failed to send caseworker email:", emailError);
        }

        results.success.push({
          row: i + 1,
          id: caseworker.id,
          email: caseworker.email,
          temporary_password: generatedPassword
        });

      } catch (error) {
        results.errors.push({
          row: i + 1,
          error: error.message
        });
      }
    }

    res.status(200).json({
      status: "success",
      message: "Bulk import completed",
      data: {
        total_processed: lines.length - 1,
        successful: results.success.length,
        failed: results.errors.length,
        results
      }
    });

  } catch (error) {
    console.error("Bulk Import Caseworkers Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Performance Report for Caseworker
export const getPerformanceReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const caseworker = await req.tenantDb.User.findOne({
      where: { id, role_id: CASEWORKER_ROLE },
      include: caseworkerInclude(req)
    });

    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null
      });
    }

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      dateFilter[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      dateFilter[Op.lte] = new Date(endDate);
    }

    // Get cases assigned to this caseworker
    const cases = await req.tenantDb.Case.findAll({
      where: {
        assignedToId: id,
        ...dateFilter
      },
      include: [
        {
          model: req.tenantDb.CaseTimeline,
          as: 'timeline',
          order: [['createdAt', 'DESC']]
        }
      ]
    });

    // Calculate metrics
    const totalCases = cases.length;
    const completedCases = cases.filter(c => c.status === 'completed').length;
    const inProgressCases = cases.filter(c => c.status === 'in_progress').length;
    const pendingCases = cases.filter(c => c.status === 'pending').length;

    // Calculate average completion time
    const completedWithTimeline = cases.filter(c => c.status === 'completed' && c.timeline && c.timeline.length > 0);
    const completionTimes = completedWithTimeline.map(c => {
      const created = new Date(c.createdAt).getTime();
      const lastUpdate = new Date(c.timeline[0].createdAt).getTime();
      return lastUpdate - created;
    });
    const avgCompletionTime = completionTimes.length > 0 
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length 
      : 0;

    res.status(200).json({
      status: "success",
      message: "Performance report retrieved successfully",
      data: {
        caseworker: {
          id: caseworker.id,
          name: `${caseworker.first_name} ${caseworker.last_name}`,
          email: caseworker.email
        },
        metrics: {
          totalCases,
          completedCases,
          inProgressCases,
          pendingCases,
          completionRate: totalCases > 0 ? (completedCases / totalCases * 100).toFixed(2) : 0,
          avgCompletionTime: Math.round(avgCompletionTime / (1000 * 60 * 60 * 24)), // in days
          dateRange: {
            startDate: startDate || 'all time',
            endDate: endDate || 'now'
          }
        }
      }
    });

  } catch (error) {
    console.error("Get Performance Report Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Reassign Case to another Caseworker
export const reassignCase = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { newCaseworkerId } = req.body;

    if (!newCaseworkerId) {
      return res.status(400).json({
        status: "error",
        message: "New caseworker ID is required",
        data: null
      });
    }

    // Find case by string caseId (e.g., "CAS-000001") to get numeric id
    const caseRecord = await req.tenantDb.Case.findOne({ where: { caseId } });
    if (!caseRecord) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null
      });
    }

    const caseData = caseRecord;

    // Verify new caseworker exists and is a caseworker
    const newCaseworker = await req.tenantDb.User.findOne({
      where: { id: newCaseworkerId, role_id: CASEWORKER_ROLE }
    });
    if (!newCaseworker) {
      return res.status(404).json({
        status: "error",
        message: "New caseworker not found or is not a caseworker",
        data: null
      });
    }

    // Update case assignment
    await caseData.update({ assignedToId: newCaseworkerId });

    // Add timeline entry
    await req.tenantDb.CaseTimeline.create({
      caseId: caseId,
      performedBy: req.user?.id || 1,
      action: 'reassigned',
      description: `Case reassigned from caseworker ${caseData.assignedToId} to caseworker ${newCaseworkerId}`,
      changes: {
        previousAssignedTo: caseData.assignedToId,
        newAssignedTo: newCaseworkerId
      }
    });

    res.status(200).json({
      status: "success",
      message: "Case reassigned successfully",
      data: {
        caseId,
        previousAssignedTo: caseData.assignedToId,
        newAssignedTo: newCaseworkerId
      }
    });

  } catch (error) {
    console.error("Reassign Case Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};
