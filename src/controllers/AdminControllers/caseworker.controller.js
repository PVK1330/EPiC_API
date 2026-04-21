import db from "../../models/index.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import multer from "multer";
import { ROLES } from "../../middlewares/role.middleware.js";
import { sendCaseworkerWelcomeEmail } from "../../services/email.service.js";
import { generateCaseworkerCredentialsTemplate } from "../../utils/emailTemplate.js";

const User = db.User;
const Role = db.Role;
const CaseworkerProfile = db.CaseworkerProfile;
const Department = db.Department;

const CASEWORKER_ROLE = ROLES.CASEWORKER;

// Multer configuration for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Get All Departments
export const getDepartments = async (req, res) => {
  try {
    const departments = await Department.findAll({
      where: { is_active: true },
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
    const existing = await Department.findOne({
      where: { name: trimmedName }
    });

    if (existing) {
      return res.status(400).json({
        status: "error",
        message: "Department already exists"
      });
    }

    // Create the department
    const department = await Department.create({
      name: trimmedName,
      is_active: true
    });

    res.status(201).json({
      status: "success",
      message: "Department created successfully",
      data: {
        department: department.name
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
    const department = await Department.findOne({
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
    const updated = await CaseworkerProfile.update(
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
    const count = await CaseworkerProfile.count({
      where: { department: name.trim() }
    });

    if (count > 0) {
      return res.status(400).json({
        status: "error",
        message: `Cannot delete department. ${count} caseworker(s) are assigned to this department.`
      });
    }

    // Find the department
    const department = await Department.findOne({
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

function caseworkerInclude() {
  return [
    {
      model: Role,
      as: 'role',
      attributes: ["id", "name"],
    },
    {
      model: CaseworkerProfile,
      as: "caseworkerProfile",
      required: false,
    },
  ];
}

// Create Caseworker
export const createCaseworker = async (req, res) => {
  const t = await db.sequelize.transaction();
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

    const existingEmail = await User.findOne({ where: { email }, transaction: t });
    if (existingEmail) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
        data: null,
      });
    }

    const existingMobile = await User.findOne({
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

    const role = await Role.findByPk(role_id, { transaction: t });
    if (!role) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "Invalid role ID",
        data: null,
      });
    }

    if (profileInput.employee_id) {
      const empTaken = await CaseworkerProfile.findOne({
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
      generatedPassword =
        Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
    }

    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const caseworker = await User.create(
      {
        first_name,
        last_name,
        email,
        country_code,
        mobile,
        role_id: CASEWORKER_ROLE,
        password: hashedPassword,
        is_email_verified: true,
        is_otp_verified: true,
        status: "active",
      },
      { transaction: t }
    );

    await CaseworkerProfile.create(
      {
        user_id: caseworker.id,
        ...profileInput,
      },
      { transaction: t }
    );

    await t.commit();
    committed = true;

    const loginUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    let emailResult = { sent: false, skipped: true };
    try {
      emailResult = await sendCaseworkerWelcomeEmail({
        to: email,
        html: generateCaseworkerCredentialsTemplate(
          email,
          generatedPassword,
          loginUrl,
          first_name
        ),
      });
    } catch (emailError) {
      console.error("Failed to send caseworker email:", emailError);
    }

    const full = await User.findOne({
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
      include: caseworkerInclude(),
    });

    const { password: _, ...caseworkerData } = caseworker.toJSON();

    res.status(201).json({
      status: "success",
      message: "Caseworker created successfully",
      data: {
        caseworker: full || caseworkerData,
        temporary_password: !password ? generatedPassword : null,
        email_sent: emailResult.sent === true,
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
    const offset = (page - 1) * limit;

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
    const includeClause = caseworkerInclude();
    
    if (department) {
      includeClause[1].where = { department: { [Op.iLike]: `%${department}%` } };
      includeClause[1].required = true;
    }

    const { count, rows: caseworkers } = await User.findAndCountAll({
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
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      distinct: true,
    });

    // Add performance metrics to each caseworker
    const caseworkersWithMetrics = await Promise.all(
      caseworkers.map(async (caseworker) => {
        const cases = await db.Case.findAll({
          where: { assignedToId: caseworker.id }
        });

        const totalCases = cases.length;
        const completedCases = cases.filter(c => c.status === 'completed').length;
        const inProgressCases = cases.filter(c => c.status === 'in_progress').length;
        const pendingCases = cases.filter(c => c.status === 'pending').length;

        const caseworkerData = caseworker.toJSON();
        caseworkerData.performance = {
          totalCases,
          completedCases,
          inProgressCases,
          pendingCases,
          completionRate: totalCases > 0 ? (completedCases / totalCases * 100).toFixed(2) : 0
        };

        return caseworkerData;
      })
    );

    res.status(200).json({
      status: "success",
      message: "Caseworkers retrieved successfully",
      data: {
        caseworkers: caseworkersWithMetrics,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(count / limit),
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
    const { id } = req.params;

    const caseworker = await User.findOne({
      where: { id, role_id: CASEWORKER_ROLE },
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
      include: caseworkerInclude(),
    });

    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Caseworker retrieved successfully",
      data: { caseworker },
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

    const caseworker = await User.findOne({
      where: { id, role_id: CASEWORKER_ROLE },
      include: [{ model: CaseworkerProfile, as: "caseworkerProfile", required: false }],
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

    if (email !== caseworker.email) {
      const existingEmail = await User.findOne({
        where: { email, id: { [Op.ne]: id } },
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
      const existingMobile = await User.findOne({
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
      const empTaken = await CaseworkerProfile.findOne({
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
      await CaseworkerProfile.create({
        user_id: caseworker.id,
        ...profileInput,
      });
    }

    const updatedCaseworker = await User.findOne({
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
      include: caseworkerInclude(),
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

    const caseworker = await User.findOne({ where: { id, role_id: CASEWORKER_ROLE } });
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

    const caseworker = await User.findOne({ where: { id, role_id: CASEWORKER_ROLE } });
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

    const caseworker = await User.findOne({ where: { id, role_id: CASEWORKER_ROLE } });
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
    const includeClause = caseworkerInclude();
    
    if (department) {
      includeClause[1].where = { department: { [Op.iLike]: `%${department}%` } };
      includeClause[1].required = true;
    }

    const caseworkers = await User.findAll({
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
        const caseworker = await User.create({
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

        await CaseworkerProfile.create({
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

    const caseworker = await User.findOne({
      where: { id, role_id: CASEWORKER_ROLE },
      include: caseworkerInclude()
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
    const cases = await db.Case.findAll({
      where: {
        assignedToId: id,
        ...dateFilter
      },
      include: [
        {
          model: db.CaseTimeline,
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

    // Verify case exists
    const caseData = await db.Case.findByPk(caseId);
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null
      });
    }

    // Verify new caseworker exists and is a caseworker
    const newCaseworker = await User.findOne({
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
    await db.CaseTimeline.create({
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
