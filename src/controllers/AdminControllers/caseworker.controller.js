import db from "../../models/index.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import { ROLES } from "../../middlewares/role.middleware.js";
import { sendCaseworkerWelcomeEmail } from "../../services/email.service.js";
import { generateCaseworkerCredentialsTemplate } from "../../utils/emailTemplate.js";

const User = db.User;
const Role = db.Role;
const CaseworkerProfile = db.CaseworkerProfile;

const CASEWORKER_ROLE = ROLES.CASEWORKER;

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
    const { page = 1, limit = 10, search, status } = req.query;
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
      include: caseworkerInclude(),
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      distinct: true,
    });

    res.status(200).json({
      status: "success",
      message: "Caseworkers retrieved successfully",
      data: {
        caseworkers,
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
