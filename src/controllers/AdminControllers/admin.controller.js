import db from "../../models/index.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import transporter from "../../config/mail.js";
import { generateAdminCredentialsTemplate } from "../../utils/emailTemplate.js";

const User = db.User;
const Role = db.Role;

// Create Admin
export const createAdmin = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id = 1, // Default to Admin role
      password,
      confirm_password
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email || !country_code || !mobile) {
      return res.status(400).json({
        status: "error",
        message: "First name, last name, email, country code, and mobile are required",
        data: null
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid email format",
        data: null
      });
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
        data: null
      });
    }

    // Check if mobile number already exists
    const existingMobile = await User.findOne({ where: { country_code, mobile } });
    if (existingMobile) {
      return res.status(400).json({
        status: "error",
        message: "Mobile number already exists",
        data: null
      });
    }

    // Validate role exists
    const role = await Role.findByPk(role_id);
    if (!role) {
      return res.status(400).json({
        status: "error",
        message: "Invalid role ID",
        data: null
      });
    }

    // Generate password if not provided
    let generatedPassword = password;
    if (!password) {
      generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
    }

    // Validate password confirmation
    if (confirm_password && password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "Password and confirm password do not match",
        data: null
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    // Create admin
    const admin = await User.create({
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id:1,
      password: hashedPassword,
      is_email_verified: true, // Auto-verify for admin-created accounts
      is_otp_verified: true, // Auto-verify for admin login
      status: 'active'
    });

    // Send admin credentials email
    try {
      const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Elite Pic - Admin Account Created",
        html: generateAdminCredentialsTemplate(email, generatedPassword, loginUrl),
      });
    } catch (emailError) {
      console.error("Failed to send admin email:", emailError);
      // Continue with response even if email fails
    }

    // Remove password from response
    const { password: _, ...adminData } = admin.toJSON();

    res.status(201).json({
      status: "success",
      message: "Admin created successfully",
      data: {
        admin: adminData,
        temporary_password: !password ? generatedPassword : null,
        email_sent: true
      }
    });

  } catch (error) {
    console.error("Create Admin Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get All Admins
export const getAllAdmins = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {
      role_id: 1 // Admin role
    };

    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    const { count, rows: admins } = await User.findAndCountAll({
      where: whereClause,
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
        attributes: ['id', 'name']
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(200).json({
      status: "success",
      message: "Admins retrieved successfully",
      data: {
        admins,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    console.error("Get All Admins Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Admin by ID
export const getAdminById = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await User.findOne({
      where: { id, role_id: 1 },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
        attributes: ['id', 'name']
      }]
    });

    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
        data: null
      });
    }

    res.status(200).json({
      status: "success",
      message: "Admin retrieved successfully",
      data: { admin }
    });

  } catch (error) {
    console.error("Get Admin by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Update Admin
export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id,
      status
    } = req.body;

    // Find admin
    const admin = await User.findOne({ where: { id, role_id: 1 } });
    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
        data: null
      });
    }

    // Validate required fields
    if (!first_name || !last_name || !email || !country_code || !mobile) {
      return res.status(400).json({
        status: "error",
        message: "First name, last name, email, country code, and mobile are required",
        data: null
      });
    }

    // Check if email is being changed and if it already exists
    if (email !== admin.email) {
      const existingEmail = await User.findOne({ 
        where: { email, id: { [Op.ne]: id } }
      });
      if (existingEmail) {
        return res.status(400).json({
          status: "error",
          message: "Email already exists",
          data: null
        });
      }
    }

    // Check if mobile is being changed and if it already exists
    if (country_code !== admin.country_code || mobile !== admin.mobile) {
      const existingMobile = await User.findOne({ 
        where: { country_code, mobile, id: { [Op.ne]: id } }
      });
      if (existingMobile) {
        return res.status(400).json({
          status: "error",
          message: "Mobile number already exists",
          data: null
        });
      }
    }

    // Validate role if provided
    if (role_id) {
      const role = await Role.findByPk(role_id);
      if (!role) {
        return res.status(400).json({
          status: "error",
          message: "Invalid role ID",
          data: null
        });
      }
    }

    // Update admin
    const updateData = {
      first_name: first_name || admin.first_name,
      last_name: last_name || admin.last_name,
      email: email || admin.email,
      country_code: country_code || admin.country_code,
      mobile: mobile || admin.mobile,
      role_id: role_id || admin.role_id,
      status: status || admin.status
    };

    await admin.update(updateData);

    // Get updated admin with role
    const updatedAdmin = await User.findOne({
      where: { id },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
        attributes: ['id', 'name']
      }]
    });

    res.status(200).json({
      status: "success",
      message: "Admin updated successfully",
      data: { admin: updatedAdmin }
    });

  } catch (error) {
    console.error("Update Admin Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Delete Admin (Soft Delete)
export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await User.findOne({ where: { id, role_id: 1 } });
    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
        data: null
      });
    }

    // Soft delete by setting status to 'inactive'
    await admin.update({ status: 'inactive' });

    res.status(200).json({
      status: "success",
      message: "Admin deleted successfully",
      data: null
    });

  } catch (error) {
    console.error("Delete Admin Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Reset Admin Password
export const resetAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password, confirm_password } = req.body;

    if (!new_password || !confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "New password and confirm password are required",
        data: null
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "Passwords do not match",
        data: null
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters long",
        data: null
      });
    }

    const admin = await User.findOne({ where: { id, role_id: 1 } });
    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
        data: null
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await admin.update({ 
      password: hashedPassword,
      temp_password: null,
      password_reset_otp: null,
      password_reset_otp_expiry: null
    });

    res.status(200).json({
      status: "success",
      message: "Password reset successfully",
      data: null
    });

  } catch (error) {
    console.error("Reset Admin Password Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Toggle Admin Status (Active/Inactive)
export const toggleAdminStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await User.findOne({ where: { id, role_id: 1 } });
    if (!admin) {
      return res.status(404).json({
        status: "error",
        message: "Admin not found",
        data: null
      });
    }

    // Toggle status between active and inactive
    const newStatus = admin.status === 'active' ? 'inactive' : 'active';
    await admin.update({ status: newStatus });

    res.status(200).json({
      status: "success",
      message: `Admin ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: {
        admin_id: admin.id,
        status: newStatus
      }
    });

  } catch (error) {
    console.error("Toggle Admin Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};