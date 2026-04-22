import db from '../models/index.js';
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

const User = db.User;

// Get user profile
export const profile = async (req, res) => {
  try {
    // Get user ID from decoded JWT token (added by auth middleware)
    const userId = req.user.userId;

    // Find user by ID
    const user = await User.findOne({
      where: { id: userId },
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
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Convert profile_pic path to URL-friendly format and add base URL
    if (user.profile_pic) {
      const normalizedPath = user.profile_pic.replace(/\\/g, '/');
      user.profile_pic = `${process.env.BASE_URL}/${normalizedPath}`;
    }

    res.status(200).json({
      status: "success",
      message: "Profile retrieved successfully",
      data: {
        user: user
      }
    });

  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: err.message
    });
  }
};

// Edit user profile
export const editProfile = async (req, res) => {
  try {
    // Get user ID from decoded JWT token
    const userId = req.user.userId;
    
    // Get editable fields from request body
    const body = req.body || {};
    const { first_name, last_name, country_code, mobile } = body;

    // Find user by ID
    const user = await User.findOne({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Validate required fields
    if (!first_name || !last_name) {
      return res.status(400).json({
        status: "error",
        message: "First name and last name are required",
        data: null
      });
    }

    // Check if mobile number is being changed and if it's already taken by another user
    if (mobile && country_code) {
      const mobileExists = await User.findOne({
        where: { 
          country_code, 
          mobile,
          id: { [Op.ne]: userId } // Exclude current user from check
        }
      });

      if (mobileExists) {
        return res.status(400).json({
          status: "error",
          message: "Mobile number already exists",
          data: null
        });
      }
    }

    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }

    const updateData = {
      first_name: first_name || user.first_name,
      last_name: last_name || user.last_name,
      country_code: country_code || user.country_code,
      mobile: mobile || user.mobile,
    };

    await user.update(updateData);

    // Return updated user profile without sensitive fields
    const updatedUser = await User.findOne({
      where: { id: userId },
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
    });

    // Convert profile_pic path to URL-friendly format and add base URL
    if (updatedUser.profile_pic) {
      const normalizedPath = updatedUser.profile_pic.replace(/\\/g, '/');
      updatedUser.profile_pic = `${process.env.BASE_URL}/${normalizedPath}`;
    }

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
      data: {
        user: updatedUser
      }
    });

  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: err.message
    });
  }
};

/** POST /api/user/change-password — authenticated user updates own password */
export const changeOwnPassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { current_password, new_password } = req.body || {};

    if (!current_password || !new_password) {
      return res.status(400).json({
        status: "error",
        message: "current_password and new_password are required",
        data: null,
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "New password must be at least 8 characters",
        data: null,
      });
    }

    const full = await User.findOne({ where: { id: userId } });
    if (!full) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null,
      });
    }

    const ok = await bcrypt.compare(current_password, full.password);
    if (!ok) {
      return res.status(400).json({
        status: "error",
        message: "Current password is incorrect",
        data: null,
      });
    }

    const hashed = await bcrypt.hash(new_password, 12);
    await full.update({ password: hashed });

    res.status(200).json({
      status: "success",
      message: "Password updated successfully.",
      data: null,
    });
  } catch (err) {
    console.error("changeOwnPassword error:", err);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: err.message,
    });
  }
};


// Get all users grouped by roles
export const getAllUsers = async (req, res) => {
  try {
    // Get all users with their roles
    const users = await User.findAll({
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
      include: [
        {
          model: db.Role,
          as: 'role',
          attributes: ['id', 'name']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Group users by role
    const usersByRole = {
      admin: [],
      candidate: [],
      sponsor: [],
      caseworker: []
    };

    users.forEach(user => {
      const roleName = user.role?.name?.toLowerCase() || 'unknown';
      
      if (roleName === 'admin') {
        usersByRole.admin.push(user);
      } else if (roleName === 'candidate') {
        usersByRole.candidate.push(user);
      } else if (roleName === 'sponsor') {
        usersByRole.sponsor.push(user);
      } else if (roleName === 'caseworker') {
        usersByRole.caseworker.push(user);
      }
    });

    res.status(200).json({
      status: "success",
      message: "Users retrieved successfully",
      data: {
        admin: usersByRole.admin,
        candidate: usersByRole.candidate,
        sponsor: usersByRole.sponsor,
        caseworker: usersByRole.caseworker
      }
    });

  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: err.message
    });
  }
};
