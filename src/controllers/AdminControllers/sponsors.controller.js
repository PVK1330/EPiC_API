import db from "../../models/index.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import multer from "multer";
import { ROLES } from "../../middlewares/role.middleware.js";
import { notifyUserCreated } from "../../services/notification.service.js";

// Multer configuration for file upload
const upload = multer({ storage: multer.memoryStorage() });

export const uploadMiddleware = upload.single('file');
import { generateStrongPassword } from "../../utils/passwordGenerator.js";

const User = db.User;
const Role = db.Role;
const SponsorProfile = db.SponsorProfile;

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
      outstandingBalance
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
      generatedPassword = generateStrongPassword(12);
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

    // Create sponsor
    const sponsor = await User.create({
      first_name,
      last_name,
      email,
      country_code,
      mobile,
      role_id,
      password: hashedPassword,
      is_email_verified: true, // Auto-verify for admin-created accounts
      is_otp_verified: true, // Auto-verify for sponsor login
      status: 'active'
    });

    // Remove password from response
    const { password: _, ...sponsorData } = sponsor.toJSON();

    // Create SponsorProfile if business fields are provided
    const hasBusinessFields = companyName || tradingName || registrationNumber || 
      sponsorLicenceNumber || industrySector || licenceStatus || licenceExpiryDate ||
      registeredAddress || city || postalCode || country || cosAllocation ||
      activeCases || sponsoredWorkers || riskLevel || riskPct || outstandingBalance;
    
    if (hasBusinessFields) {
      const profileData = {};
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

      await SponsorProfile.create({
        userId: sponsor.id,
        ...profileData
      });
    }

    // Send notification to all admins about new sponsor creation
    try {
      await notifyUserCreated(ROLES.ADMIN, {
        id: sponsor.id,
        email: sponsor.email,
        role: 'sponsor',
        first_name: sponsor.first_name,
        last_name: sponsor.last_name,
      });
    } catch (notifError) {
      console.error('Failed to send user creation notification:', notifError);
    }

    res.status(201).json({
      status: "success",
      message: "Sponsor created successfully",
      data: {
        sponsor: sponsorData,
        temporary_password: !password ? generatedPassword : null
      }
    });

  } catch (error) {
    console.error("Create Sponsor Error:", error);
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
      model: Role,
      as: 'role',
      attributes: ['id', 'name']
    }, {
      model: SponsorProfile,
      as: 'sponsorProfile',
      required: false
    }];

    const { count, rows: sponsors } = await User.findAndCountAll({
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
    console.error("Get All Sponsors Error:", error);
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

    const sponsor = await User.findOne({
      where: { id, role_id: 4 },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
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
    console.error("Get Sponsor by ID Error:", error);
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
    } = req.body;

    // Find sponsor
    const sponsor = await User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
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
    if (email !== sponsor.email) {
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
    if (country_code !== sponsor.country_code || mobile !== sponsor.mobile) {
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

    // Update sponsor
    const updateData = {
      first_name: first_name || sponsor.first_name,
      last_name: last_name || sponsor.last_name,
      email: email || sponsor.email,
      country_code: country_code || sponsor.country_code,
      mobile: mobile || sponsor.mobile,
      role_id: role_id || sponsor.role_id,
      status: status || sponsor.status
    };

    await sponsor.update(updateData);

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
      let profile = await SponsorProfile.findOne({ where: { userId: id } });
      
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
        await SponsorProfile.create({
          userId: id,
          ...profileData
        });
      }
    }

    // Get updated sponsor with role and profile
    const updatedSponsor = await User.findOne({
      where: { id },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [{
        model: Role,
        as: 'role',
        attributes: ['id', 'name']
      }, {
        model: SponsorProfile,
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
    console.error("Update Sponsor Error:", error);
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

    const sponsor = await User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    // Soft delete by setting status to 'inactive'
    await sponsor.update({ status: 'inactive' });

    res.status(200).json({
      status: "success",
      message: "Sponsor deleted successfully",
      data: null
    });

  } catch (error) {
    console.error("Delete Sponsor Error:", error);
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

    const sponsor = await User.findOne({ where: { id, role_id: 4 } });
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
    console.error("Reset Sponsor Password Error:", error);
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

    const sponsor = await User.findOne({ where: { id, role_id: 4 } });
    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    // Toggle status between active and inactive
    const newStatus = sponsor.status === 'active' ? 'inactive' : 'active';
    await sponsor.update({ status: newStatus });

    res.status(200).json({
      status: "success",
      message: `Sponsor ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: {
        sponsor_id: sponsor.id,
        status: newStatus
      }
    });

  } catch (error) {
    console.error("Toggle Sponsor Status Error:", error);
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
        const generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
        const hashedPassword = await bcrypt.hash(generatedPassword, 12);

        const sponsor = await User.create({
          first_name: rowData.first_name || rowData.firstName || '',
          last_name: rowData.last_name || rowData.lastName || '',
          email: rowData.email,
          country_code: rowData.country_code || rowData.countryCode || '+1',
          mobile: rowData.mobile,
          role_id: 4,
          password: hashedPassword,
          is_email_verified: true,
          is_otp_verified: true,
          status: 'active'
        });

        // Create SponsorProfile if business fields are provided
        if (rowData.companyName || rowData.licenceStatus || rowData.riskLevel) {
          await SponsorProfile.create({
            userId: sponsor.id,
            companyName: rowData.companyName || null,
            licenceStatus: rowData.licenceStatus || null,
            riskLevel: rowData.riskLevel || null
          });
        }

        // Send notification to sponsor about account creation with credentials
        try {
          await notifyUserCreated(ROLES.BUSINESS, {
            id: sponsor.id,
            email: sponsor.email,
            password: generatedPassword,
            role: 'sponsor',
            first_name: sponsor.first_name,
            last_name: sponsor.last_name,
          });
        } catch (notifError) {
          console.error(`Failed to send notification to ${sponsor.email}:`, notifError);
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
    console.error("Bulk Import Sponsors Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Export Sponsors to CSV
export const exportSponsors = async (req, res) => {
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

    const sponsors = await User.findAll({
      where: whereClause,
      attributes: {
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password']
      },
      include: [{
        model: Role,
        as: 'role',
        attributes: ['id', 'name']
      }, {
        model: SponsorProfile,
        as: 'sponsorProfile',
        required: false
      }],
      order: [["createdAt", "DESC"]]
    });

    // Generate CSV
    const csvHeader = ['ID', 'First Name', 'Last Name', 'Email', 'Country Code', 'Mobile', 'Company Name', 'Licence Status', 'Risk Level', 'Role', 'Status', 'Created At'];
    const csvRows = sponsors.map(sponsor => [
      sponsor.id,
      sponsor.first_name,
      sponsor.last_name,
      sponsor.email,
      sponsor.country_code,
      sponsor.mobile,
      sponsor.sponsorProfile?.companyName || '',
      sponsor.sponsorProfile?.licenceStatus || '',
      sponsor.sponsorProfile?.riskLevel || '',
      sponsor.role?.name || 'N/A',
      sponsor.status,
      sponsor.createdAt.toISOString()
    ]);

    const csvContent = [
      csvHeader.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sponsors_export.csv"');
    res.send(csvContent);

  } catch (error) {
    console.error("Export Sponsors Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};