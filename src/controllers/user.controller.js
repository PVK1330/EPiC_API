import db from '../models/index.js';
import { Op } from 'sequelize';

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
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      }
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
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
    const { first_name, last_name, country_code, mobile } = req.body;

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

    // Update user profile
    const updateData = {
      first_name: first_name || user.first_name,
      last_name: last_name || user.last_name,
      country_code: country_code || user.country_code,
      mobile: mobile || user.mobile
    };

    await user.update(updateData);

    // Return updated user profile without sensitive fields
    const updatedUser = await User.findOne({
      where: { id: userId },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      }
    });

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