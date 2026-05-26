import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import catchAsync from '../../utils/catchAsync.js';
import ApiResponse from '../../utils/apiResponse.js';
import { generateStrongPassword } from '../../utils/passwordGenerator.js';
import { ROLES } from '../../middlewares/role.middleware.js';
import platformDb from '../../models/index.js';
import { isPlatformEmailTaken } from '../../utils/platformUserEmail.js';
import { createUserOnPlatformAndTenant } from '../../services/userSync.service.js';
import { sendTenantAdminWelcomeEmail } from '../../services/tenantUserMail.service.js';
import { ensureAdminHasAllPermissions } from '../../seeders/permission.seeder.js';

/** Tenant users with role "admin" (matches org provisioning + tenantSeed). */
const ADMIN_ROLE_ID = ROLES.ADMIN;

/**
 * Create Admin
 */
export const createAdmin = catchAsync(async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    country_code,
    mobile,
    role_id = ADMIN_ROLE_ID,
    status = 'active',
    password,
    confirm_password
  } = req.body;

  // Validate required fields
  if (!first_name || !last_name || !email || !country_code || !mobile) {
    return ApiResponse.badRequest(res, "First name, last name, email, country code, and mobile are required");
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return ApiResponse.badRequest(res, "Invalid email format");
  }

  const emailNorm = String(email).trim().toLowerCase();
  const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
  if (!organisationId) {
    return ApiResponse.badRequest(res, "Organisation context is required to create an admin");
  }

  if (await isPlatformEmailTaken(platformDb, emailNorm, organisationId)) {
    return ApiResponse.badRequest(res, "Email already exists for this organisation");
  }

  // Check if mobile number already exists
  const existingMobile = await req.tenantDb.User.findOne({ where: { country_code, mobile } });
  if (existingMobile) {
    return ApiResponse.badRequest(res, "Mobile number already exists");
  }

  // Validate role exists
  const role = await req.tenantDb.Role.findByPk(role_id);
  if (!role) {
    return ApiResponse.badRequest(res, "Invalid role ID");
  }

  // Generate password if not provided
  let generatedPassword = password;
  if (!password) {
    generatedPassword = generateStrongPassword(12);
  }

  // Validate password confirmation
  if (confirm_password && password !== confirm_password) {
    return ApiResponse.badRequest(res, "Password and confirm password do not match");
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(generatedPassword, 12);

  await ensureAdminHasAllPermissions(req.tenantDb);

  // Create admin in platform registry + this organisation's tenant DB only
  const admin = await createUserOnPlatformAndTenant(req.tenantDb, {
    first_name,
    last_name,
    email: emailNorm,
    country_code,
    mobile,
    role_id: ADMIN_ROLE_ID,
    password: hashedPassword,
    is_email_verified: true,
    is_otp_verified: true,
    status: status || 'active',
    temp_password: 'pending_reset',
    organisation_id: organisationId,
  });

  let welcomeEmail = { sent: false, reason: "not_attempted" };
  try {
    welcomeEmail = await sendTenantAdminWelcomeEmail({
      user: admin,
      plainPassword: generatedPassword,
      organisationId,
    });
  } catch (emailError) {
    console.error("Failed to send admin welcome email:", emailError);
    welcomeEmail = { sent: false, reason: emailError?.message || "send_failed" };
  }

  const { password: _, ...adminData } = admin.toJSON();

  return ApiResponse.created(
    res,
    welcomeEmail.sent
      ? "Admin created successfully. Login details sent by email."
      : "Admin created successfully. Configure EMAIL_USER/EMAIL_PASS to send login details.",
    {
      admin: adminData,
      temporary_password: !password && !welcomeEmail.sent ? generatedPassword : null,
      email_sent: welcomeEmail.sent === true,
      login_url: welcomeEmail.loginUrl,
      welcome_email: welcomeEmail,
    },
  );
});

/**
 * Get All Admins
 */
export const getAllAdmins = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, search, status, role } = req.query;
  const offset = (page - 1) * limit;

  const whereClause = { role_id: ADMIN_ROLE_ID };

  if (search) {
    whereClause[Op.or] = [
      { first_name: { [Op.iLike]: `%${search}%` } },
      { last_name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { mobile: { [Op.iLike]: `%${search}%` } }
    ];
  }

  if (status) whereClause.status = status;
  if (role) whereClause.role_id = parseInt(role, 10) || ADMIN_ROLE_ID;

  const { count, rows: admins } = await req.tenantDb.User.findAndCountAll({
    where: whereClause,
    attributes: { 
      exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
    },
    include: [{
      model: req.tenantDb.Role,
      as: "role",
      attributes: ['id', 'name']
    }],
    order: [["createdAt", "DESC"]],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  return ApiResponse.success(res, "Admins retrieved successfully", {
    admins,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(count / limit)
    }
  });
});

/**
 * Get Admin by ID
 */
export const getAdminById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const admin = await req.tenantDb.User.findOne({
    where: { id, role_id: ADMIN_ROLE_ID },
    attributes: { 
      exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
    },
    include: [{
      model: req.tenantDb.Role,
      as: "role",
      attributes: ['id', 'name']
    }]
  });

  if (!admin) {
    return ApiResponse.notFound(res, "Admin not found");
  }

  return ApiResponse.success(res, "Admin retrieved successfully", { admin });
});

/**
 * Update Admin
 */
export const updateAdmin = catchAsync(async (req, res) => {
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

  const admin = await req.tenantDb.User.findOne({ where: { id, role_id: ADMIN_ROLE_ID } });
  if (!admin) {
    return ApiResponse.notFound(res, "Admin not found");
  }

  if (!first_name || !last_name || !email || !country_code || !mobile) {
    return ApiResponse.badRequest(res, "First name, last name, email, country code, and mobile are required");
  }

  if (email !== admin.email) {
    const existingEmail = await req.tenantDb.User.findOne({ 
      where: { email, id: { [Op.ne]: id } }
    });
    if (existingEmail) {
      return ApiResponse.badRequest(res, "Email already exists");
    }
  }

  if (country_code !== admin.country_code || mobile !== admin.mobile) {
    const existingMobile = await req.tenantDb.User.findOne({ 
      where: { country_code, mobile, id: { [Op.ne]: id } }
    });
    if (existingMobile) {
      return ApiResponse.badRequest(res, "Mobile number already exists");
    }
  }

  if (role_id) {
    const role = await req.tenantDb.Role.findByPk(role_id);
    if (!role) {
      return ApiResponse.badRequest(res, "Invalid role ID");
    }
  }

  if (status === 'inactive') {
    const orgId = req.user?.organisation_id;
    if (orgId) {
      const platformOrg = await platformDb.Organisation.findByPk(orgId);
      if (platformOrg && platformOrg.primaryEmail === admin.email) {
        return ApiResponse.badRequest(res, "Cannot deactivate the primary organisation admin.");
      }
    }
  }

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

  const updatedAdmin = await req.tenantDb.User.findOne({
    where: { id },
    attributes: { 
      exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
    },
    include: [{
      model: req.tenantDb.Role,
      as: "role",
      attributes: ['id', 'name']
    }]  
  });

  return ApiResponse.success(res, "Admin updated successfully", { admin: updatedAdmin });
});

/**
 * Delete Admin (Soft Delete)
 */
export const deleteAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;

  const admin = await req.tenantDb.User.findOne({ where: { id, role_id: ADMIN_ROLE_ID } });
  if (!admin) {
    return ApiResponse.notFound(res, "Admin not found");
  }

  const orgId = req.user?.organisation_id;
  if (orgId) {
    const platformOrg = await platformDb.Organisation.findByPk(orgId);
    if (platformOrg && platformOrg.primaryEmail === admin.email) {
      return ApiResponse.badRequest(res, "Cannot delete the primary organisation admin.");
    }
  }

  await admin.update({ status: 'inactive' });

  return ApiResponse.success(res, "Admin deleted successfully");
});

/**
 * Reset Admin Password
 */
export const resetAdminPassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { new_password, confirm_password } = req.body;

  if (!new_password || !confirm_password) {
    return ApiResponse.badRequest(res, "New password and confirm password are required");
  }

  if (new_password !== confirm_password) {
    return ApiResponse.badRequest(res, "Passwords do not match");
  }

  if (new_password.length < 6) {
    return ApiResponse.badRequest(res, "Password must be at least 6 characters long");
  }

  const admin = await req.tenantDb.User.findOne({ where: { id, role_id: ADMIN_ROLE_ID } });
  if (!admin) {
    return ApiResponse.notFound(res, "Admin not found");
  }

  const hashedPassword = await bcrypt.hash(new_password, 12);

  await admin.update({ 
    password: hashedPassword,
    temp_password: null,
    password_reset_otp: null,
    password_reset_otp_expiry: null
  });

  return ApiResponse.success(res, "Password reset successfully");
});

/**
 * Toggle Admin Status (Active/Inactive)
 */
export const toggleAdminStatus = catchAsync(async (req, res) => {
  const { id } = req.params;

  const admin = await req.tenantDb.User.findOne({ where: { id, role_id: ADMIN_ROLE_ID } });
  if (!admin) {
    return ApiResponse.notFound(res, "Admin not found");
  }

  const newStatus = admin.status === 'active' ? 'inactive' : 'active';

  if (newStatus === 'inactive') {
    const orgId = req.user?.organisation_id;
    if (orgId) {
      const platformOrg = await platformDb.Organisation.findByPk(orgId);
      if (platformOrg && platformOrg.primaryEmail === admin.email) {
        return ApiResponse.badRequest(res, "Cannot deactivate the primary organisation admin.");
      }
    }
  }

  await admin.update({ status: newStatus });

  return ApiResponse.success(res, `Admin ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`, {
    admin_id: admin.id,
    status: newStatus
  });
});

/**
 * Export Admins to CSV
 */
export const exportAdmins = catchAsync(async (req, res) => {
  const { search, status, role } = req.query;

  const whereClause = { role_id: ADMIN_ROLE_ID };

  if (search) {
    whereClause[Op.or] = [
      { first_name: { [Op.iLike]: `%${search}%` } },
      { last_name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { mobile: { [Op.iLike]: `%${search}%` } }
    ];
  }

  if (status) whereClause.status = status;
  if (role) whereClause.role_id = parseInt(role, 10) || ADMIN_ROLE_ID;

  const admins = await req.tenantDb.User.findAll({
    where: whereClause,
    attributes: {
      exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password']
    },
    include: [{
      model: req.tenantDb.Role,
      as: "role",
      attributes: ['id', 'name']
    }],
    order: [["createdAt", "DESC"]]
  });

  const csvHeader = ['ID', 'First Name', 'Last Name', 'Email', 'Country Code', 'Mobile', 'Role', 'Status', 'Created At'];
  const csvRows = admins.map(admin => [
    admin.id,
    admin.first_name,
    admin.last_name,
    admin.email,
    admin.country_code,
    admin.mobile,
    admin.role?.name || 'N/A',
    admin.status,
    admin.createdAt.toISOString()
  ]);

  const csvContent = [
    csvHeader.join(','),
    ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="admins_export.csv"');
  return res.send(csvContent);
});
