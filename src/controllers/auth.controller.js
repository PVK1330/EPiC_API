import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import db from '../models/index.js';
import transporter from '../config/mail.js';
import { generateOTPTemplate, generateCredentialsTemplate } from '../utils/emailTemplate.js';

const User = db.User;
const UnverifiedUser = db.UnverifiedUser;
const AdminUserPreference = db.AdminUserPreference;
const RESET_TOKEN_EXPIRY = '10m';
const RESET_TOKEN_PURPOSE = 'password_reset';

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

    // Also check unverified_users to avoid unique constraint errors
    const unverifiedEmailExists = await UnverifiedUser.findOne({ where: { email } });
    if (unverifiedEmailExists) {
      return res.status(400).json({
        status: "error",
        message: "Registration already in progress. Please verify your OTP or request a new one.",
        data: { email, pending_verification: true }
      });
    }

    const unverifiedMobileExists = await UnverifiedUser.findOne({
      where: { country_code, mobile },
    });
    if (unverifiedMobileExists) {
      return res.status(400).json({
        status: "error",
        message: "Mobile number already registered and pending OTP verification.",
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
      temp_password: null,
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
    const originalPassword = 'Use the password you set during registration';
    
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

    // Get role name for the payload
    const role = await db.Role.findByPk(verifiedUser.role_id);

    const payload = {
      userId: verifiedUser.id,
      email: verifiedUser.email,
      role_id: verifiedUser.role_id,
      role_name: role?.name || null,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });



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

    const emailNorm = String(email).trim().toLowerCase();

    const user = await db.User.findOne({
      where: { email: emailNorm },
      include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
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

    if (user.two_factor_enabled) {
      return res.status(200).json({
        status: 'success',
        message: '2FA verification required',
        data: {
          requires_2fa: true,
          email: user.email,
        },
      });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role_id: user.role_id,
      role_name: user.role?.name || null,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });



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
          role_name: user.role?.name,
          status: user.status,
          two_factor_enabled: user.two_factor_enabled,
        },
        token,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({
      status: 'error',
      message: isProd ? 'Login failed. Please try again.' : err.message,
      data: null,
      ...(!isProd && { error: err.message }),
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

    const resetToken = jwt.sign(
      { email: user.email, purpose: RESET_TOKEN_PURPOSE },
      process.env.JWT_SECRET,
      { expiresIn: RESET_TOKEN_EXPIRY }
    );

    res.status(200).json({
      status: "success",
      message: "OTP verified successfully",
      data: {
        email: email,
        otp_verified: true,
        next_step: "set_password",
        reset_token: resetToken
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
    const { email, password, confirmPassword, resetToken } = req.body;
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    if (!resetToken) {
      return res.status(400).json({
        status: "error",
        message: "Reset token is required",
        data: null
      });
    }

    let decodedResetToken;
    try {
      decodedResetToken = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired reset token",
        data: null
      });
    }

    if (
      decodedResetToken?.purpose !== RESET_TOKEN_PURPOSE ||
      decodedResetToken?.email !== email
    ) {
      return res.status(401).json({
        status: "error",
        message: "Invalid reset token",
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
      html: `<p>Your password was updated successfully.</p><p>You can now log in at <a href="${loginUrl}">${loginUrl}</a>.</p>`,
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

// Send OTP for password change verification
export const sendPasswordChangeOtp = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.otp_code = otp;
    user.otp_expiry = otpExpiry;
    await user.save();

    // Send OTP via email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Elite Pic - Password Change Verification OTP",
      html: generateOTPTemplate(otp),
    });

    res.status(200).json({
      status: "success",
      message: "OTP sent to your email for password change verification",
      data: {
        expiry: otpExpiry
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

export const setup2FA = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        data: null,
      });
    }

    if (user.two_factor_enabled) {
      return res.status(400).json({
        status: 'error',
        message: '2FA is already enabled',
        data: null,
      });
    }

    const secret = speakeasy.generateSecret({
      name: `EPiC (${user.email})`,
      issuer: 'EPiC',
    });

    user.two_factor_secret = secret.base32;
    await user.save();

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.status(200).json({
      status: 'success',
      message: '2FA setup initiated',
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        backupCodes: generateBackupCodes(),
      },
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to setup 2FA',
      data: null,
      error: err.message,
    });
  }
};

export const verify2FASetup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token, backupCodes } = req.body;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        data: null,
      });
    }

    if (!user.two_factor_secret) {
      return res.status(400).json({
        status: 'error',
        message: '2FA not setup. Please initiate setup first.',
        data: null,
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: token,
    });

    if (!verified) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid verification code',
        data: null,
      });
    }

    user.two_factor_enabled = true;
    user.two_factor_backup_codes = backupCodes || generateBackupCodes();
    await user.save();

    try {
      const [prefs] = await AdminUserPreference.findOrCreate({
        where: { user_id: userId },
        defaults: { user_id: userId },
      });
      await prefs.update({ two_factor_enabled: true });
    } catch (prefErr) {
      console.error('Admin preferences sync after 2FA enable:', prefErr);
    }

    res.status(200).json({
      status: 'success',
      message: '2FA enabled successfully',
      data: {
        two_factor_enabled: true,
        backup_codes: user.two_factor_backup_codes,
      },
    });
  } catch (err) {
    console.error('2FA verification error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify 2FA setup',
      data: null,
      error: err.message,
    });
  }
};

export const verify2FA = async (req, res) => {
  try {
    const { email, password, token } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required.',
        data: null,
      });
    }

    const user = await db.User.findOne({
      where: { email },
      include: [{ model: db.Role, as: 'role', attributes: ['id', 'name'] }],
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

    if (!user.two_factor_enabled) {
      return res.status(400).json({
        status: 'error',
        message: '2FA is not enabled for this account',
        data: null,
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: token,
    });

    if (!verified) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid 2FA code',
        data: null,
      });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role_id: user.role_id,
      role_name: user.role?.name || null,
    };

    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Login successful with 2FA.',
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role_id: user.role_id,
          role_name: user.role?.name,
          status: user.status,
          two_factor_enabled: true,
        },
        token: jwtToken,
      },
    });
  } catch (err) {
    console.error('2FA login error:', err);
    return res.status(500).json({
      status: 'error',
      message: '2FA login failed. Please try again.',
      data: null,
    });
  }
};

export const disable2FA = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        data: null,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid password',
        data: null,
      });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({
        status: 'error',
        message: '2FA is not enabled for this account',
        data: null,
      });
    }

    user.two_factor_enabled = false;
    user.two_factor_secret = null;
    user.two_factor_backup_codes = null;
    await user.save();

    try {
      const [prefs] = await AdminUserPreference.findOrCreate({
        where: { user_id: userId },
        defaults: { user_id: userId },
      });
      await prefs.update({ two_factor_enabled: false });
    } catch (prefErr) {
      console.error('Admin preferences sync after 2FA disable:', prefErr);
    }

    res.status(200).json({
      status: 'success',
      message: '2FA disabled successfully',
      data: {
        two_factor_enabled: false,
      },
    });
  } catch (err) {
    console.error('2FA disable error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to disable 2FA',
      data: null,
      error: err.message,
    });
  }
};

function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(speakeasy.generateSecret().base32.substring(0, 8).toUpperCase());
  }
  return codes;
}
