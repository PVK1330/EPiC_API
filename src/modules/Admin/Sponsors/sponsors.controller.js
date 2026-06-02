import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import platformDb from '../../../models/index.js';
import { isPlatformEmailTaken, normalizePlatformEmail } from '../../../utils/platformUserEmail.js';
import { ROLES } from '../../../middlewares/role.middleware.js';
import { notifyUserCreated } from '../../../services/notification.service.js';
import {
  createUserOnPlatformAndTenant,
  syncUserToPlatformAndTenant,
} from '../../../services/userSync.service.js';
import { sendTenantSponsorWelcomeEmail } from '../../../services/tenantUserMail.service.js';
import catchAsync from '../../../utils/catchAsync.js';
import ApiResponse from '../../../utils/apiResponse.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';
import logger from '../../../utils/logger.js';

// Multer configuration for file upload
const upload = multer({ storage: multer.memoryStorage() });

export const uploadMiddleware = upload.single('file');
import { generateStrongPassword } from '../../../utils/passwordGenerator.js';

// Create Sponsor
export const createSponsor = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id = 4, // Default to Sponsor role
      password,
      confirm_password,
      companyName,
      tradingName,
      registrationNumber,
      industrySector,
      sponsorLicenceNumber,
      licenceStatus,
      licenceExpiryDate,
      registeredAddress,
      city,
      postalCode,
      country,
      cosAllocation,
      activeCases,
      sponsoredWorkers,
      riskLevel,
      riskPct,
      outstandingBalance,
      authorisingName,
      authorisingPhone,
      authorisingEmail,
      notes
    } = req.validated.body;

    const organisationId =
      req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    if (!organisationId) {
      return res.status(400).json({
        status: "error",
        message: "Organisation context is required",
        data: null,
      });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const sponsorRoleId = Number(role_id) || ROLES.BUSINESS;

    if (sponsorRoleId !== ROLES.BUSINESS) {
      return res.status(400).json({
        status: "error",
        message: "role_id must be the sponsor (business) role",
        data: null,
      });
    }

    if (await isPlatformEmailTaken(platformDb, emailNorm, organisationId)) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists for this organisation",
        data: null,
      });
    }

    const existingMobile = await req.tenantDb.User.findOne({ where: { country_code, mobile } });
    if (existingMobile) {
      return res.status(400).json({
        status: "error",
        message: "Mobile number already exists",
        data: null,
      });
    }

    const role = await req.tenantDb.Role.findByPk(sponsorRoleId);
    if (!role) {
      return res.status(400).json({
        status: "error",
        message: "Invalid role ID",
        data: null,
      });
    }

    let generatedPassword = password;
    if (!password) {
      generatedPassword = generateStrongPassword(12);
    }

    if (confirm_password && password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "Password and confirm password do not match",
        data: null,
      });
    }

    if (generatedPassword && generatedPassword.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters",
        data: null,
      });
    }

    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const sponsor = await createUserOnPlatformAndTenant(req.tenantDb, {
      first_name,
      last_name,
      email: emailNorm,
      country_code,
      mobile,
      role_id: sponsorRoleId,
      password: hashedPassword,
      is_email_verified: true,
      is_otp_verified: true,
      status: "active",
      organisation_id: organisationId,
    });

    const profileData = { organisation_id: organisationId };
    if (companyName) profileData.companyName = companyName;
    if (tradingName) profileData.tradingName = tradingName;
    if (registrationNumber) profileData.registrationNumber = registrationNumber;
    if (industrySector) profileData.industrySector = industrySector;
    if (sponsorLicenceNumber) profileData.sponsorLicenceNumber = sponsorLicenceNumber;
    if (licenceStatus) profileData.licenceStatus = licenceStatus;
    if (licenceExpiryDate) profileData.licenceExpiryDate = licenceExpiryDate;
    if (registeredAddress) profileData.registeredAddress = registeredAddress;
    if (city) profileData.city = city;
    if (postalCode) profileData.postalCode = postalCode;
    if (country) profileData.country = country;
    if (cosAllocation) profileData.cosAllocation = cosAllocation;
    if (activeCases) profileData.activeCases = activeCases;
    if (sponsoredWorkers) profileData.sponsoredWorkers = sponsoredWorkers;
    if (riskLevel) profileData.riskLevel = riskLevel;
    if (riskPct) profileData.riskPct = riskPct;
    if (outstandingBalance) profileData.outstandingBalance = outstandingBalance;
    if (authorisingName) profileData.authorisingName = authorisingName;
    if (authorisingPhone) profileData.authorisingPhone = authorisingPhone;
    if (authorisingEmail) profileData.authorisingEmail = authorisingEmail;
    if (notes) profileData.notes = notes;

    await req.tenantDb.SponsorProfile.create({
      userId: sponsor.id,
      ...profileData,
    });

    let emailResult = { sent: false, skipped: true };
    try {
      emailResult = await sendTenantSponsorWelcomeEmail({
        user: sponsor,
        plainPassword: generatedPassword,
        organisationId,
        firstName: first_name,
      });
    } catch (emailError) {
      logger.error({ err: emailError }, "Failed to send sponsor welcome email");
    }

    try {
      await notifyUserCreated(req.tenantDb, ROLES.ADMIN, {
        id: sponsor.id,
        email: sponsor.email,
        role: "sponsor",
        first_name: sponsor.first_name,
        last_name: sponsor.last_name,
      });
    } catch (notifError) {
      logger.error({ err: notifError }, "Failed to send user creation notification");
    }

    const { password: _, ...sponsorData } = sponsor.toJSON();

    res.status(201).json({
      status: "success",
      message: emailResult.sent
        ? "Sponsor created successfully. Welcome email sent."
        : "Sponsor created successfully.",
      data: {
        sponsor: sponsorData,
        temporary_password: !password ? generatedPassword : null,
        welcome_email_sent: emailResult.sent === true,
        login_url: emailResult.loginUrl || null,
      },
    });

  } catch (error) {
    logger.error({ err: error }, "Create Sponsor Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get All Sponsors
export const getAllSponsors = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, licenceStatus, riskLevel } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {
      role_id: 4 // Sponsor/Business role (User said 4 is business)
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

    // Build include clause
    const includeClause = [{
      model: req.tenantDb.Role,
      as: 'role',
      attributes: ['id', 'name']
    }, {
      model: req.tenantDb.SponsorProfile,
      as: 'sponsorProfile',
      required: false
    }];

    const { count, rows: sponsors } = await req.tenantDb.User.findAndCountAll({
      where: whereClause,
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: includeClause,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(200).json({
      status: "success",
      message: "Sponsors retrieved successfully",
      data: {
        sponsors,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    logger.error({ err: error }, "Get All Sponsors Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Sponsor by ID
export const getSponsorById = async (req, res) => {
  try {
    const { id } = req.params;

    const sponsor = await req.tenantDb.User.findOne({
      where: { id, role_id: 4 },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: req.tenantDb.Role,
        as: 'role',
        attributes: ['id', 'name']
      }]
    });

    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    res.status(200).json({
      status: "success",
      message: "Sponsor retrieved successfully",
      data: { sponsor }
    });

  } catch (error) {
    logger.error({ err: error }, "Get Sponsor by ID Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
} // Added closing bracket here
export const updateSponsor = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id,
      status,
      companyName,
      tradingName,
      registrationNumber,
      sponsorLicenceNumber,
      licenceRating,
      industrySector,
      yearEstablished,
      website,
      registeredAddress,
      tradingAddress,
      city,
      state,
      country,
      postalCode,
      authorisingName,
      authorisingPhone,
      authorisingEmail,
      keyContactName,
      keyContactPhone,
      keyContactEmail,
      ownershipType,
      hrName,
      hrPhone,
      hrEmail,
      licenceIssueDate,
      licenceExpiryDate,
      cosAllocation,
      billingName,
      billingEmail,
      billingPhone,
      outstandingBalance,
      paymentTerms,
      sponsorLetter,
      insuranceCertificate,
      hrPolicies,
      organisationalChart,
      recruitmentDocs,
      licenceStatus,
      riskLevel,
      activeCases,
      sponsoredWorkers,
      notes,
      riskPct
    } = req.validated.body;

    // Find sponsor
    const sponsor = await req.tenantDb.User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const emailNorm = normalizePlatformEmail(email || sponsor.email);
    if (emailNorm !== normalizePlatformEmail(sponsor.email)) {
      if (organisationId && (await isPlatformEmailTaken(platformDb, emailNorm, organisationId))) {
        return res.status(400).json({
          status: "error",
          message: "Email already exists for this organisation",
          data: null,
        });
      }
      const existingEmail = await req.tenantDb.User.findOne({
        where: { email: emailNorm, id: { [Op.ne]: id } },
      });
      if (existingEmail) {
        return res.status(400).json({
          status: "error",
          message: "Email already exists",
          data: null,
        });
      }
    }

    // Check if mobile is being changed and if it already exists
    if (country_code !== sponsor.country_code || mobile !== sponsor.mobile) {
      const existingMobile = await req.tenantDb.User.findOne({ 
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
      const role = await req.tenantDb.Role.findByPk(role_id);
      if (!role) {
        return res.status(400).json({
          status: "error",
          message: "Invalid role ID",
          data: null
        });
      }
    }

    // Update sponsor
    const updateData = {
      first_name: first_name || sponsor.first_name,
      last_name: last_name || sponsor.last_name,
      email: emailNorm,
      country_code: country_code || sponsor.country_code,
      mobile: mobile || sponsor.mobile,
      role_id: role_id || sponsor.role_id,
      status: status || sponsor.status,
    };

    await syncUserToPlatformAndTenant(req.tenantDb, sponsor.id, updateData);

    // Update SponsorProfile if business fields are provided
    const hasBusinessFields = companyName || tradingName || registrationNumber || 
      sponsorLicenceNumber || licenceRating || industrySector || yearEstablished || 
      website || registeredAddress || tradingAddress || city || state || country || 
      postalCode || authorisingName || authorisingPhone || authorisingEmail || 
      keyContactName || keyContactPhone || keyContactEmail || ownershipType || 
      hrName || hrPhone || hrEmail || licenceIssueDate || licenceExpiryDate || 
      cosAllocation || billingName || billingEmail || billingPhone || 
      outstandingBalance || paymentTerms || sponsorLetter || insuranceCertificate || 
      hrPolicies || organisationalChart || recruitmentDocs || licenceStatus || riskLevel ||
      activeCases || sponsoredWorkers || notes || riskPct;
    
    if (hasBusinessFields) {
      let profile = await req.tenantDb.SponsorProfile.findOne({ where: { userId: id } });
      
      const profileData = {};
      if (companyName) profileData.companyName = companyName;
      if (tradingName) profileData.tradingName = tradingName;
      if (registrationNumber) profileData.registrationNumber = registrationNumber;
      if (sponsorLicenceNumber) profileData.sponsorLicenceNumber = sponsorLicenceNumber;
      if (licenceRating) profileData.licenceRating = licenceRating;
      if (industrySector) profileData.industrySector = industrySector;
      if (yearEstablished) profileData.yearEstablished = yearEstablished;
      if (website) profileData.website = website;
      if (registeredAddress) profileData.registeredAddress = registeredAddress;
      if (tradingAddress) profileData.tradingAddress = tradingAddress;
      if (city) profileData.city = city;
      if (state) profileData.state = state;
      if (country) profileData.country = country;
      if (postalCode) profileData.postalCode = postalCode;
      if (authorisingName) profileData.authorisingName = authorisingName;
      if (authorisingPhone) profileData.authorisingPhone = authorisingPhone;
      if (authorisingEmail) profileData.authorisingEmail = authorisingEmail;
      if (keyContactName) profileData.keyContactName = keyContactName;
      if (keyContactPhone) profileData.keyContactPhone = keyContactPhone;
      if (keyContactEmail) profileData.keyContactEmail = keyContactEmail;
      if (ownershipType) profileData.ownershipType = ownershipType;
      if (hrName) profileData.hrName = hrName;
      if (hrPhone) profileData.hrPhone = hrPhone;
      if (hrEmail) profileData.hrEmail = hrEmail;
      if (licenceIssueDate) profileData.licenceIssueDate = licenceIssueDate;
      if (licenceExpiryDate) profileData.licenceExpiryDate = licenceExpiryDate;
      if (cosAllocation) profileData.cosAllocation = cosAllocation;
      if (billingName) profileData.billingName = billingName;
      if (billingEmail) profileData.billingEmail = billingEmail;
      if (billingPhone) profileData.billingPhone = billingPhone;
      if (outstandingBalance) profileData.outstandingBalance = outstandingBalance;
      if (paymentTerms) profileData.paymentTerms = paymentTerms;
      if (sponsorLetter) profileData.sponsorLetter = sponsorLetter;
      if (insuranceCertificate) profileData.insuranceCertificate = insuranceCertificate;
      if (hrPolicies) profileData.hrPolicies = hrPolicies;
      if (organisationalChart) profileData.organisationalChart = organisationalChart;
      if (recruitmentDocs) profileData.recruitmentDocs = recruitmentDocs;
      if (licenceStatus) profileData.licenceStatus = licenceStatus;
      if (riskLevel) profileData.riskLevel = riskLevel;
      if (activeCases) profileData.activeCases = activeCases;
      if (sponsoredWorkers) profileData.sponsoredWorkers = sponsoredWorkers;
      if (notes) profileData.notes = notes;
      if (riskPct) profileData.riskPct = riskPct;

      if (profile) {
        await profile.update(profileData);
      } else {
        await req.tenantDb.SponsorProfile.create({
          userId: id,
          ...profileData
        });
      }
    }

    // Get updated sponsor with role and profile
    const updatedSponsor = await req.tenantDb.User.findOne({
      where: { id },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: req.tenantDb.Role,
        as: 'role',
        attributes: ['id', 'name']
      }, {
        model: req.tenantDb.SponsorProfile,
        as: 'sponsorProfile',
        required: false
      }]
    });

    res.status(200).json({
      status: "success",
      message: "Sponsor updated successfully",
      data: { sponsor: updatedSponsor }
    });

  } catch (error) {
    logger.error({ err: error }, "Update Sponsor Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Delete Sponsor (Soft Delete)
export const deleteSponsor = async (req, res) => {
  try {
    const { id } = req.params;

    const sponsor = await req.tenantDb.User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    await syncUserToPlatformAndTenant(req.tenantDb, sponsor.id, { status: "inactive" });

    res.status(200).json({
      status: "success",
      message: "Sponsor deleted successfully",
      data: null
    });

  } catch (error) {
    logger.error({ err: error }, "Delete Sponsor Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Reset Sponsor Password
export const resetSponsorPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password, confirm_password } = req.validated.body;

    const sponsor = await req.tenantDb.User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await sponsor.update({ 
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
    logger.error({ err: error }, "Reset Sponsor Password Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Toggle Sponsor Status (Active/Inactive)
export const toggleSponsorStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const sponsor = await req.tenantDb.User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    const newStatus = sponsor.status === "active" ? "inactive" : "active";
    await syncUserToPlatformAndTenant(req.tenantDb, sponsor.id, { status: newStatus });

    res.status(200).json({
      status: "success",
      message: `Sponsor ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: {
        sponsor_id: sponsor.id,
        status: newStatus
      }
    });

  } catch (error) {
    logger.error({ err: error }, "Toggle Sponsor Status Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Bulk Import Sponsors from CSV
export const bulkImportSponsors = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: "error",
        message: "No file uploaded",
        data: null
      });
    }

    const csvData = req.file.buffer.toString('utf-8');
    const lines = csvData.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return res.status(400).json({
        status: "error",
        message: "CSV file is empty or has no data rows",
        data: null
      });
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const results = {
      success: [],
      errors: []
    };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const rowData = {};
        
        headers.forEach((header, index) => {
          rowData[header] = values[index] || '';
        });

        // Generate password
        const organisationId = req.user?.organisation_id;
        if (!organisationId) {
          throw new Error("Organisation context is required");
        }

        const emailNorm = String(rowData.email || "").trim().toLowerCase();
        if (!emailNorm) {
          throw new Error("Email is required");
        }

        const generatedPassword =
          Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
        const hashedPassword = await bcrypt.hash(generatedPassword, 12);

        const sponsor = await createUserOnPlatformAndTenant(req.tenantDb, {
          first_name: rowData.first_name || rowData.firstName || "",
          last_name: rowData.last_name || rowData.lastName || "",
          email: emailNorm,
          country_code: rowData.country_code || rowData.countryCode || "+1",
          mobile: rowData.mobile,
          role_id: ROLES.BUSINESS,
          password: hashedPassword,
          is_email_verified: true,
          is_otp_verified: true,
          status: "active",
          temp_password: 'pending_reset',
          organisation_id: organisationId,
        });

        await req.tenantDb.SponsorProfile.create({
          userId: sponsor.id,
          organisation_id: organisationId,
          companyName: rowData.companyName || null,
          licenceStatus: rowData.licenceStatus || null,
          riskLevel: rowData.riskLevel || null,
        });

        try {
          await sendTenantSponsorWelcomeEmail({
            user: sponsor,
            plainPassword: generatedPassword,
            organisationId,
            firstName: sponsor.first_name,
          });
        } catch (emailError) {
          logger.error({ err: emailError, email: sponsor.email }, 'Failed to send sponsor email');
        }

        try {
          await notifyUserCreated(req.tenantDb, ROLES.ADMIN, {
            id: sponsor.id,
            email: sponsor.email,
            role: "sponsor",
            first_name: sponsor.first_name,
            last_name: sponsor.last_name,
          });
        } catch (notifError) {
          logger.error({ err: notifError, email: sponsor.email }, 'Failed to send notification');
        }

        results.success.push({
          row: i + 1,
          id: sponsor.id,
          email: sponsor.email,
          temporary_password: generatedPassword
        });

      } catch (error) {
        results.errors.push({
          row: i + 1,
          error: error.message
        });
      }
    }

    res.status(200).json({
      status: "success",
      message: "Bulk import completed",
      data: {
        total_processed: lines.length - 1,
        successful: results.success.length,
        failed: results.errors.length,
        results
      }
    });

  } catch (error) {
    logger.error({ err: error }, "Bulk Import Sponsors Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

export const exportSponsors = catchAsync(async (req, res) => {
  try {
    const { search, status, licenceStatus, riskLevel } = req.query;

    const whereClause = {
      role_id: 4 // Sponsor/Business role
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

    // Note: licenceStatus and riskLevel filters require SponsorProfile model
    // These parameters are added for future use when sponsor profile is implemented

    const sponsors = await req.tenantDb.User.findAll({
      where: whereClause,
      attributes: {
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password']
      },
      include: [{
        model: req.tenantDb.Role,
        as: 'role',
        attributes: ['id', 'name']
      }, {
        model: req.tenantDb.SponsorProfile,
        as: 'sponsorProfile',
        required: false
      }],
      order: [["createdAt", "DESC"]]
    });

    const columns = [
      { key: 'id', header: 'ID' },
      { key: 'firstName', header: 'First Name' },
      { key: 'lastName', header: 'Last Name' },
      { key: 'email', header: 'Email' },
      { key: 'countryCode', header: 'Country Code' },
      { key: 'mobile', header: 'Mobile' },
      { key: 'companyName', header: 'Company Name' },
      { key: 'licenceStatus', header: 'Licence Status' },
      { key: 'riskLevel', header: 'Risk Level' },
      { key: 'role', header: 'Role' },
      { key: 'status', header: 'Status' },
      { key: 'createdAt', header: 'Created At' },
    ];

    const rows = sponsors.map((sponsor) => ({
      id: sponsor.id,
      firstName: sponsor.first_name,
      lastName: sponsor.last_name,
      email: sponsor.email,
      countryCode: sponsor.country_code,
      mobile: sponsor.mobile,
      companyName: sponsor.sponsorProfile?.companyName || '',
      licenceStatus: sponsor.sponsorProfile?.licenceStatus || '',
      riskLevel: sponsor.sponsorProfile?.riskLevel || '',
      role: sponsor.role?.name || 'N/A',
      status: sponsor.status,
      createdAt: sponsor.createdAt ? sponsor.createdAt.toISOString() : '',
    }));

    const buffer = rowsToXlsxBuffer(rows, columns);
    sendXlsxDownload(res, buffer, 'sponsors_export.xlsx');
  } catch (err) {
    return ApiResponse.error(res, 'Failed to export sponsors', 500, err);
  }
});
