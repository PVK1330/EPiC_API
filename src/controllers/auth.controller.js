const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../models");
const transporter = require("../config/mail");
const { generateOTPTemplate, generateCredentialsTemplate } = require("../utils/emailTemplate");

const User = db.User;
const UnverifiedUser = db.UnverifiedUser;


exports.register = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      password,
      country_code,
      mobile,
      role_id,
    } = req.body;

    // ✅ Required fields validation
    if (!first_name || !last_name) {
      return res.status(400).json({
        status: "error",
        message: "First name and last name are required",
        data: null
      });
    }

    // ✅ password validation
    if (!password || password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters",
        data: null
      });
    }

    // ✅ email unique
    const emailExists = await User.findOne({ where: { email } });
    if (emailExists) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
        data: null
      });
    }

    // ✅ mobile + country_code unique
    const mobileExists = await User.findOne({
      where: { country_code, mobile },
    });

    if (mobileExists) {
      return res.status(400).json({
        status: "error",
        message: "Mobile number already exists",
        data: null
      });
    }

    // ✅ role validation (only allow 1–4)
    const validRoles = [1, 2, 3, 4];
    if (!validRoles.includes(role_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid role_id (allowed: 1,2,3,4)",
        data: null
      });
    }

    // 🔐 hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // create unverified user
    const unverifiedUser = await UnverifiedUser.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
      country_code,
      mobile,
      role_id,
      otp_code: otp,
      otp_expiry: otpExpiry,
      temp_password: password, // Store original password temporarily
    });

    // send mail
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - OTP Verification",
      html: generateOTPTemplate(otp),
    });

    res.status(201).json({
      status: "success",
      message: "User registered successfully",
      data: {
        email: email,
        otp_sent: true
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

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Find user in unverified users table
    const unverifiedUser = await UnverifiedUser.findOne({ where: { email } });

    if (!unverifiedUser) {
      return res.status(404).json({ 
        status: "error",
        message: "User not found or already verified",
        data: null 
      });
    }

    if (unverifiedUser.otp_code !== otp) {
      return res.status(400).json({ 
        status: "error",
        message: "Invalid OTP",
        data: null 
      });
    }

    if (new Date() > unverifiedUser.otp_expiry) {
      return res.status(400).json({ 
        status: "error",
        message: "OTP expired",
        data: null 
      });
    }

    // Send welcome email with credentials
    const loginUrl = `${process.env.FRONTEND_URL}`;
    const originalPassword = unverifiedUser.temp_password; // Get stored original password
    
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - Welcome! Your Account is Verified",
      html: generateCredentialsTemplate(email, originalPassword, loginUrl),
    });

    // Move user to verified users table
    const verifiedUser = await User.create({
      first_name: unverifiedUser.first_name,
      last_name: unverifiedUser.last_name,
      email: unverifiedUser.email,
      password: unverifiedUser.password,
      country_code: unverifiedUser.country_code,
      mobile: unverifiedUser.mobile,
      role_id: unverifiedUser.role_id,
      is_otp_verified: true,
    });

    // Remove user from unverified users table
    await unverifiedUser.destroy();

    // Generate JWT token for automatic login
    const token = jwt.sign(
      {
        userId: verifiedUser.id,
        email: verifiedUser.email,
        role_id: verifiedUser.role_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Remove sensitive fields from response
    const userResponse = {
      id: verifiedUser.id,
      first_name: verifiedUser.first_name,
      last_name: verifiedUser.last_name,
      email: verifiedUser.email,
      country_code: verifiedUser.country_code,
      mobile: verifiedUser.mobile,
      role_id: verifiedUser.role_id,
      is_otp_verified: verifiedUser.is_otp_verified,
      createdAt: verifiedUser.createdAt,
    };

    res.status(200).json({
      status: "success",
      message: "Email verified successfully. You are now logged in!",
      data: {
        email: email,
        is_verified: true,
        credentials_sent: true,
        token: token,
        user: userResponse
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

// Resend OTP API
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user is already verified
    const verifiedUser = await User.findOne({ where: { email } });
    if (verifiedUser) {
      return res.status(400).json({ 
        status: "error",
        message: "User already verified. Please login instead.",
        data: null 
      });
    }

    // Find user in unverified users table
    const unverifiedUser = await UnverifiedUser.findOne({ where: { email } });

    if (!unverifiedUser) {
      return res.status(404).json({ 
        status: "error",
        message: "User not found. Please register first.",
        data: null 
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    unverifiedUser.otp_code = otp;
    unverifiedUser.otp_expiry = otpExpiry;

    await unverifiedUser.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - OTP Verification",
      html: generateOTPTemplate(otp),
    });

    res.status(200).json({
      status: "success",
      message: "OTP resent successfully",
      data: {
        email: email,
        otp_sent: true
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

// Login API
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ 
        status: "error",
        message: "User not found",
        data: null 
      });
    }

    // Check if email is verified
    if (!user.is_otp_verified) {
      return res.status(400).json({ 
        status: "error",
        message: "Please verify your email first",
        data: null 
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ 
        status: "error",
        message: "Invalid credentials",
        data: null 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role_id: user.role_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Remove sensitive fields from response
    const userResponse = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      country_code: user.country_code,
      mobile: user.mobile,
      role_id: user.role_id,
      is_otp_verified: user.is_otp_verified,
      createdAt: user.createdAt,
    };

    res.status(200).json({
      status: "success",
      message: "Login successful",
      data: {
        token: token,
        user: userResponse
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









// Forgot Password API - Send OTP for password reset
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ 
        status: "error",
        message: "User not found",
        data: null 
      });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Save OTP to user for password reset
    user.password_reset_otp = otp;
    user.password_reset_otp_expiry = otpExpiry;
    await user.save();

    // Send OTP email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - Password Reset OTP",
      html: generateOTPTemplate(otp),
    });

    res.status(200).json({
      status: "success",
      message: "Password reset OTP sent to your email",
      data: {
        email: email,
        otp_sent: true,
        next_step: "verify_otp"
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

// Verify Password Reset OTP
exports.verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Verify OTP
    if (user.password_reset_otp !== otp) {
      return res.status(400).json({
        status: "error",
        message: "Invalid OTP",
        data: null
      });
    }

    if (new Date() > user.password_reset_otp_expiry) {
      return res.status(400).json({
        status: "error",
        message: "OTP expired",
        data: null
      });
    }

    res.status(200).json({
      status: "success",
      message: "OTP verified successfully",
      data: {
        email: email,
        otp_verified: true,
        next_step: "set_password"
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

// Set New Password after OTP verification
exports.setPassword = async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;

    // Find user
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Verify OTP was already verified (check if reset OTP exists and is valid)
    if (!user.password_reset_otp || new Date() > user.password_reset_otp_expiry) {
      return res.status(400).json({
        status: "error",
        message: "OTP verification required or expired",
        data: null
      });
    }

    // Validate passwords
    if (!password || !confirmPassword) {
      return res.status(400).json({
        status: "error",
        message: "Password and confirm password are required",
        data: null
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        status: "error",
        message: "Passwords do not match",
        data: null
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters",
        data: null
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear OTP
    user.password = hashedPassword;
    user.password_reset_otp = null;
    user.password_reset_otp_expiry = null;
    await user.save();

    // Send email with new credentials
    const loginUrl = `${process.env.FRONTEND_URL}`;
    
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - Password Updated Successfully",
      html: generateCredentialsTemplate(email, password, loginUrl),
    });

    res.status(200).json({
      status: "success",
      message: "Password updated successfully",
      data: {
        email: email,
        password_updated: true,
        credentials_sent: true
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


// Resend otp API - user table
exports.resendOtpUser = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    user.otp_code = otp;
    user.otp_expiry = otpExpiry;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - OTP Verification",
      html: generateOTPTemplate(otp),
    });

    res.status(200).json({
      status: "success",
      message: "OTP sent successfully",
      data: { email }
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

//Verify OTP API - user table
exports.verifyOtpUser = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Verify OTP
    if (user.otp_code !== otp) {
      return res.status(400).json({
        status: "error",
        message: "Invalid OTP",
        data: null
      });
    }

    if (new Date() > user.otp_expiry) {
      return res.status(400).json({
        status: "error",
        message: "OTP expired",
        data: null
      });
    }

    // Mark OTP as verified
    user.is_otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;
    await user.save();

    res.status(200).json({
      status: "success",
      message: "OTP verified successfully",
      data: {
        email: email,
        is_verified: true
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

// Logout API
exports.logout = async (req, res) => {
  try {
    // For JWT tokens, logout is typically handled client-side by removing the token
    // This endpoint can be used for logging purposes or future session management
    
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(400).json({
        status: "error",
        message: "No token provided",
        data: null
      });
    }

    // Verify the token is valid before logout
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // You could add token blacklisting logic here if needed
    // For now, we'll just confirm successful logout
    
    res.status(200).json({
      status: "success",
      message: "Logout successful",
      data: {
        logged_out: true,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired token",
        data: null
      });
    }
    
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: err.message
    });
  }
};

