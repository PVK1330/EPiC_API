const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../models");
const transporter = require("../config/mail");
const { generateOTPTemplate, generateCredentialsTemplate } = require("../utils/emailTemplate");

const User = db.User;


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
        message: "First name and last name are required",
      });
    }

    // ✅ password validation
    if (!password || password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    // ✅ email unique
    const emailExists = await User.findOne({ where: { email } });
    if (emailExists) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // ✅ mobile + country_code unique
    const mobileExists = await User.findOne({
      where: { country_code, mobile },
    });

    if (mobileExists) {
      return res.status(400).json({
        message: "Mobile number already exists",
      });
    }

    // ✅ role validation (only allow 1–4)
    const validRoles = [1, 2, 3, 4];
    if (!validRoles.includes(role_id)) {
      return res.status(400).json({
        message: "Invalid role_id (allowed: 1,2,3,4)",
      });
    }

    // 🔐 hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔢 generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // ✅ create user
    const user = await User.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
      country_code,
      mobile,
      role_id,
      otp_code: otp,
      otp_expiry: otpExpiry,
    });

    // send mail
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - OTP Verification",
      html: generateOTPTemplate(otp),
    });

    res.status(201).json({
      message: "User registered. OTP sent",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp_code !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (new Date() > user.otp_expiry) {
      return res.status(400).json({ message: "OTP expired" });
    }

    // Verify
    user.is_otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;

    await user.save();

    // Send credentials email with login URL
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
    const originalPassword = req.body.password; // Get original password from request
    
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - Your Account Credentials",
      html: generateCredentialsTemplate(email, originalPassword, loginUrl),
    });

    res.json({ message: "Email verified successfully. Credentials sent to your email" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Resend OTP API
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

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

    res.json({ message: "OTP resent successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Login API
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if email is verified
    if (!user.is_otp_verified) {
      return res.status(400).json({ message: "Please verify your email first" });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role_id: user.role_id,
      },
      process.env.JWT_SECRET || "your-secret-key",
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

    res.json({
      message: "Login successful",
      token,
      user: userResponse,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Forgot Password API
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Save OTP to user
    user.otp_code = otp;
    user.otp_expiry = otpExpiry;
    await user.save();

    // Send OTP email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - Password Reset OTP",
      html: generateOTPTemplate(otp),
    });

    res.json({ message: "Password reset OTP sent to your email" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Reset Password API
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Find user
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify OTP
    if (user.otp_code !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (new Date() > user.otp_expiry) {
      return res.status(400).json({ message: "OTP expired" });
    }

    // Validate new password
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear OTP
    user.password = hashedPassword;
    user.otp_code = null;
    user.otp_expiry = null;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};