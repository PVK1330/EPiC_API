const db = require("../../models");
const { Op } = require("sequelize");
const bcrypt = require("bcryptjs");

const User = db.User;
const Role = db.Role;

// Create Caseworker
exports.createCaseworker = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id = 2, // Default to Caseworker role
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

    // Create caseworker
    const caseworker = await User.create({
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id,
      password: hashedPassword,
      is_email_verified: true, // Auto-verify for admin-created accounts
      is_active: true
    });

    // Remove password from response
    const { password: _, ...caseworkerData } = caseworker.toJSON();

    res.status(201).json({
      status: "success",
      message: "Caseworker created successfully",
      data: {
        caseworker: caseworkerData,
        temporary_password: !password ? generatedPassword : null
      }
    });

  } catch (error) {
    console.error("Create Caseworker Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get All Caseworkers
exports.getAllCaseworkers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {
      role_id: 2 // Caseworker role
    };

    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (status === 'active') {
      whereClause.is_active = true;
    } else if (status === 'inactive') {
      whereClause.is_active = false;
    }

    const { count, rows: caseworkers } = await User.findAndCountAll({
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
      message: "Caseworkers retrieved successfully",
      data: {
        caseworkers,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    console.error("Get All Caseworkers Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Caseworker by ID
exports.getCaseworkerById = async (req, res) => {
  try {
    const { id } = req.params;

    const caseworker = await User.findOne({
      where: { id, role_id: 2 },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
        attributes: ['id', 'name']
      }]
    });

    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null
      });
    }

    res.status(200).json({
      status: "success",
      message: "Caseworker retrieved successfully",
      data: { caseworker }
    });

  } catch (error) {
    console.error("Get Caseworker by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Update Caseworker
exports.updateCaseworker = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id,
      is_active
    } = req.body;

    // Find caseworker
    const caseworker = await User.findOne({ where: { id, role_id: 2 } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
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
    if (email !== caseworker.email) {
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
    if (country_code !== caseworker.country_code || mobile !== caseworker.mobile) {
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

    // Update caseworker
    const updateData = {
      first_name: first_name || caseworker.first_name,
      last_name: last_name || caseworker.last_name,
      email: email || caseworker.email,
      country_code: country_code || caseworker.country_code,
      mobile: mobile || caseworker.mobile,
      role_id: role_id || caseworker.role_id,
      is_active: is_active !== undefined ? is_active : caseworker.is_active
    };

    await caseworker.update(updateData);

    // Get updated caseworker with role
    const updatedCaseworker = await User.findOne({
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
      message: "Caseworker updated successfully",
      data: { caseworker: updatedCaseworker }
    });

  } catch (error) {
    console.error("Update Caseworker Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Delete Caseworker (Soft Delete)
exports.deleteCaseworker = async (req, res) => {
  try {
    const { id } = req.params;

    const caseworker = await User.findOne({ where: { id, role_id: 2 } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null
      });
    }

    // Soft delete by setting is_active to false
    await caseworker.update({ is_active: false });

    res.status(200).json({
      status: "success",
      message: "Caseworker deleted successfully",
      data: null
    });

  } catch (error) {
    console.error("Delete Caseworker Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Reset Caseworker Password
exports.resetCaseworkerPassword = async (req, res) => {
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

    const caseworker = await User.findOne({ where: { id, role_id: 2 } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await caseworker.update({ 
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
    console.error("Reset Caseworker Password Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Toggle Caseworker Status (Active/Inactive)
exports.toggleCaseworkerStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const caseworker = await User.findOne({ where: { id, role_id: 2 } });
    if (!caseworker) {
      return res.status(404).json({
        status: "error",
        message: "Caseworker not found",
        data: null
      });
    }

    // Toggle status
    const newStatus = !caseworker.is_active;
    await caseworker.update({ is_active: newStatus });

    res.status(200).json({
      status: "success",
      message: `Caseworker ${newStatus ? 'activated' : 'deactivated'} successfully`,
      data: {
        caseworker_id: caseworker.id,
        is_active: newStatus
      }
    });

  } catch (error) {
    console.error("Toggle Caseworker Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};