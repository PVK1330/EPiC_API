import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../models/index.js';
import transporter from '../config/mail.js';
import { generateOTPTemplate, generateCredentialsTemplate } from '../utils/emailTemplate.js';

const User = db.User;
const UnverifiedUser = db.UnverifiedUser;

export const register = async (req, res) => {
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

    if (!first_name || !last_name) {
      return res.status(400).json({
        status: "error",
        message: "First name and last name are required",
        data: null
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters",
        data: null
      });
    }

    const emailExists = await User.findOne({ where: { email } });
    if (emailExists) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
        data: null
      });
    }

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

    const validRoles = [1, 2, 3, 4];
    if (!validRoles.includes(role_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid role_id (allowed: 1,2,3,4)",
        data: null
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await UnverifiedUser.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
      country_code,
      mobile,
      role_id,
      otp_code: otp,
      otp_expiry: otpExpiry,
      temp_password: password,
    });

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

export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
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

    const loginUrl = `${process.env.FRONTEND_URL}`;
    const originalPassword = unverifiedUser.temp_password;
    
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Elite Pic - Welcome! Your Account is Verified",
      html: generateCredentialsTemplate(email, originalPassword, loginUrl),
    });

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

    await unverifiedUser.destroy();

    const payload = {
      userId: verifiedUser.id,
      email: verifiedUser.email,
      role_id: verifiedUser.role_id,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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

export const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const verifiedUser = await User.findOne({ where: { email } });
    if (verifiedUser) {
      return res.status(400).json({ 
        status: "error",
        message: "User already verified. Please login instead.",
        data: null 
      });
    }

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

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required.',
        data: null,
      });
    }

    const user = await db.User.findOne({
      where: { email },
      include: [{ model: db.Role, attributes: ['id', 'name'] }],
    });

    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid credentials.',
        data: null,
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        status: 'error',
        message: 'Account is inactive or suspended.',
        data: null,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid credentials.',
        data: null,
      });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role_id: user.role_id,
      role_name: user.Role?.name || null,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Login successful.',
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role_id: user.role_id,
          role_name: user.Role?.name,
          status: user.status,
        },
        token,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Login failed. Please try again.',
      data: null,
    });
  }
};

export const logout = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  return res.status(200).json({
    status: 'success',
    message: 'Logged out successfully.',
    data: null,
  });
};

export const forgotPassword = async (req, res) => {
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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    user.password_reset_otp = otp;
    user.password_reset_otp_expiry = otpExpiry;
    await user.save();

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

export const verifyResetOTP = async (req, res) => {
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

export const setPassword = async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    if (!user.password_reset_otp || new Date() > user.password_reset_otp_expiry) {
      return res.status(400).json({
        status: "error",
        message: "OTP verification required or expired",
        data: null
      });
    }

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

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.password_reset_otp = null;
    user.password_reset_otp_expiry = null;
    await user.save();

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

export const resendOtpUser = async (req, res) => {
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

export const verifyOtpUser = async (req, res) => {
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
