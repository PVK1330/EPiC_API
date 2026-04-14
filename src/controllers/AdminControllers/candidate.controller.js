import db from "../../models/index.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";

const User = db.User;
const Role = db.Role;

// Create Candidate
export const createCandidate = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id = 3, // Default to Candidate role
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

    // Create candidate
    const candidate = await User.create({
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id: 3, // Always set to Candidate role
      password: hashedPassword,
      is_email_verified: true, // Auto-verify for admin-created accounts
      is_otp_verified: true, // Auto-verify for candidate login
      status: 'active'
    });

    // Remove password from response
    const { password: _, ...candidateData } = candidate.toJSON();

    res.status(201).json({
      status: "success",
      message: "Candidate created successfully",
      data: {
        candidate: candidateData,
        temporary_password: !password ? generatedPassword : null
      }
    });

  } catch (error) {
    console.error("Create Candidate Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get All Candidates
export const getAllCandidates = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {
      role_id: 3 // Candidate role
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

    const { count, rows: candidates } = await User.findAndCountAll({
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
      message: "Candidates retrieved successfully",
      data: {
        candidates,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    console.error("Get All Candidates Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Candidate by ID
export const getCandidateById = async (req, res) => {
  try {
    const { id } = req.params;

    const candidate = await User.findOne({
      where: { id, role_id: 3 },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
        attributes: ['id', 'name']
      }]
    });

    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null
      });
    }

    res.status(200).json({
      status: "success",
      message: "Candidate retrieved successfully",
      data: { candidate }
    });

  } catch (error) {
    console.error("Get Candidate by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Update Candidate
export const updateCandidate = async (req, res) => {
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

    // Find candidate
    const candidate = await User.findOne({ where: { id, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
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
    if (email !== candidate.email) {
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
    if (country_code !== candidate.country_code || mobile !== candidate.mobile) {
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

    // Update candidate
    const updateData = {
      first_name: first_name || candidate.first_name,
      last_name: last_name || candidate.last_name,
      email: email || candidate.email,
      country_code: country_code || candidate.country_code,
      mobile: mobile || candidate.mobile,
      role_id: role_id || candidate.role_id,
      status: status || candidate.status
    };

    await candidate.update(updateData);

    // Get updated candidate with role
    const updatedCandidate = await User.findOne({
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
      message: "Candidate updated successfully",
      data: { candidate: updatedCandidate }
    });

  } catch (error) {
    console.error("Update Candidate Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Delete Candidate (Soft Delete)
export const deleteCandidate = async (req, res) => {
  try {
    const { id } = req.params;

    const candidate = await User.findOne({ where: { id, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null
      });
    }

    // Soft delete by setting status to 'inactive'
    await candidate.update({ status: 'inactive' });

    res.status(200).json({
      status: "success",
      message: "Candidate deleted successfully",
      data: null
    });

  } catch (error) {
    console.error("Delete Candidate Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Reset Candidate Password
export const resetCandidatePassword = async (req, res) => {
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

    const candidate = await User.findOne({ where: { id, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await candidate.update({ 
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
    console.error("Reset Candidate Password Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Toggle Candidate Status (Active/Inactive)
export const toggleCandidateStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const candidate = await User.findOne({ where: { id, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null
      });
    }

    // Toggle status between active and inactive
    const newStatus = candidate.status === 'active' ? 'inactive' : 'active';
    await candidate.update({ status: newStatus });

    res.status(200).json({
      status: "success",
      message: `Candidate ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: {
        candidate_id: candidate.id,
        status: newStatus
      }
    });

  } catch (error) {
    console.error("Toggle Candidate Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};