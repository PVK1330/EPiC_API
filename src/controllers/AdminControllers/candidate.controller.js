import db from "../../models/index.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import multer from "multer";
import { ROLES } from "../../middlewares/role.middleware.js";
import { notifyUserCreated } from "../../services/notification.service.js";
import { generateStrongPassword } from "../../utils/passwordGenerator.js";

const User = db.User;
const Role = db.Role;
const CandidateApplication = db.CandidateApplication;
const CandidateAccountSettings = db.CandidateAccountSettings;
const CandidateFeedback = db.CandidateFeedback;
const Document = db.Document;
const Case = db.Case;
const VisaType = db.VisaType;
const PetitionType = db.PetitionType;
const CasePayment = db.CasePayment;
const Notification = db.Notification;

// Multer configuration for file upload
const upload = multer({ storage: multer.memoryStorage() });

export const uploadMiddleware = upload.single("file");

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
      confirm_password,
      application, // Application data for child table
      applicationData, // Legacy application data backup
      // Legacy fields for compatibility
      phone,
      passportExpiry,
      visaExpiry,
      countryOfBirth,
      caseStatus,
      rightToWork,
      jobTitle,
      linkedBusiness,
      employmentStart,
      paymentStatus,
      feeAmount,
      city,
      postcode,
      country,
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email || !country_code || !mobile) {
      return res.status(400).json({
        status: "error",
        message:
          "First name, last name, email, country code, and mobile are required",
        data: null,
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid email format",
        data: null,
      });
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
        data: null,
      });
    }

    // Check if mobile number already exists
    const existingMobile = await User.findOne({
      where: { country_code, mobile },
    });
    if (existingMobile) {
      return res.status(400).json({
        status: "error",
        message: "Mobile number already exists",
        data: null,
      });
    }

    // Validate role exists
    const role = await Role.findByPk(role_id);
    if (!role) {
      return res.status(400).json({
        status: "error",
        message: "Invalid role ID",
        data: null,
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
        data: null,
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    // Create candidate with transaction
    const result = await db.sequelize.transaction(async (t) => {
      // Create user record
      const candidate = await User.create(
        {
          first_name,
          last_name,
          email,
          country_code,
          mobile,
          role_id: 3, // Always set to Candidate role
          password: hashedPassword,
          is_email_verified: true, // Auto-verify for admin-created accounts
          is_otp_verified: true, // Auto-verify for candidate login
          status: "active",
          // Legacy fields for compatibility
          phone,
          passportExpiry,
          visaExpiry,
          countryOfBirth,
          caseStatus,
          rightToWork,
          jobTitle,
          linkedBusiness,
          employmentStart,
          paymentStatus,
          feeAmount,
          city,
          postcode,
          country,
          // Store complete application data as backup
          applicationData,
        },
        { transaction: t },
      );

      // Create application record if application data is provided
      if (application && typeof application === "object") {
        await CandidateApplication.create(
          {
            userId: candidate.id,
            ...application,
          },
          { transaction: t },
        );
      }

      return candidate;
    });

    // Remove password from response
    const { password: _, ...candidateData } = result.toJSON();

    // Send notification to all admins about new candidate creation
    try {
      await notifyUserCreated(ROLES.ADMIN, {
        id: result.id,
        email: result.email,
        role: "candidate",
        first_name: result.first_name,
        last_name: result.last_name,
      });
    } catch (notifError) {
      console.error("Failed to send user creation notification:", notifError);
    }

    res.status(201).json({
      status: "success",
      message: "Candidate created successfully",
      data: {
        candidate: candidateData,
        temporary_password: !password ? generatedPassword : null,
      },
    });
  } catch (error) {
    console.error("Create Candidate Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get All Candidates
export const getAllCandidates = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      visaType,
      paymentStatus,
    } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {
      role_id: 3, // Candidate role
    };

    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    // Build include clause for filtering by visa type and payment status
    const includeClause = [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
      },
      {
        model: CandidateApplication,
        as: "application",
        required: false,
        attributes: ["id", "userId", "status", "submittedAt", "visaType"]
      },
    ];

    const caseWhere = {};

    if (visaType) {
      caseWhere.visaTypeId = visaType;
    }

    if (paymentStatus) {
      if (paymentStatus === "Paid") {
        caseWhere.paidAmount = { [Op.col]: "totalAmount" };
      } else if (paymentStatus === "Partial") {
        caseWhere.paidAmount = {
          [Op.gt]: 0,
          [Op.lt]: db.sequelize.col("totalAmount"),
        };
      } else if (paymentStatus === "Outstanding") {
        caseWhere.paidAmount = 0;
      }
    }

    if (Object.keys(caseWhere).length > 0) {
      includeClause.push({
        model: db.Case,
        as: "cases",
        where: caseWhere,
        required: true,
        attributes: [],
      });
    }


    // Filtering by visa type and payment status temporarily disabled to fix 500 error
    // TODO: Re-enable after Case associations are properly configured

    const { count, rows: candidates } = await User.findAndCountAll({
      where: whereClause,
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
      include: includeClause,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
      distinct: true,
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
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get All Candidates Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
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
          model: Role,
          as: "role",
          attributes: ["id", "name"],
        },
        {
          model: CandidateApplication,
          as: "application",
          required: false,
        },
      ],
    });

    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Candidate retrieved successfully",
      data: { candidate },
    });
  } catch (error) {
    console.error("Get Candidate by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
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
      status,
      application, // Application data for child table
      applicationData, // Legacy application data backup
      // Legacy fields for compatibility
      phone,
      passportExpiry,
      visaExpiry,
      countryOfBirth,
      caseStatus,
      rightToWork,
      jobTitle,
      linkedBusiness,
      employmentStart,
      paymentStatus,
      feeAmount,
      city,
      postcode,
      country,
    } = req.body;

    // Find candidate
    const candidate = await User.findOne({ where: { id, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null,
      });
    }

    // Validate required fields
    if (!first_name || !last_name || !email || !country_code || !mobile) {
      return res.status(400).json({
        status: "error",
        message:
          "First name, last name, email, country code, and mobile are required",
        data: null,
      });
    }

    // Check if email is being changed and if it already exists
    if (email !== candidate.email) {
      const existingEmail = await User.findOne({
        where: { email, id: { [Op.ne]: id } },
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
    if (
      country_code !== candidate.country_code ||
      mobile !== candidate.mobile
    ) {
      const existingMobile = await User.findOne({
        where: { country_code, mobile, id: { [Op.ne]: id } },
      });
      if (existingMobile) {
        return res.status(400).json({
          status: "error",
          message: "Mobile number already exists",
          data: null,
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
          data: null,
        });
      }
    }

    // Update candidate with transaction
    await db.sequelize.transaction(async (t) => {
      // Update user record
      const updateData = {
        first_name: first_name || candidate.first_name,
        last_name: last_name || candidate.last_name,
        email: email || candidate.email,
        country_code: country_code || candidate.country_code,
        mobile: mobile || candidate.mobile,
        role_id: role_id || candidate.role_id,
        status: status || candidate.status,
        // Legacy fields for compatibility
        phone,
        passportExpiry,
        visaExpiry,
        countryOfBirth,
        caseStatus,
        rightToWork,
        jobTitle,
        linkedBusiness,
        employmentStart,
        paymentStatus,
        feeAmount,
        city,
        postcode,
        country,
        // Store complete application data as backup
        applicationData,
      };

      await candidate.update(updateData, { transaction: t });

      // Update or create application record if application data is provided
      if (application && typeof application === "object") {
        const existingApplication = await CandidateApplication.findOne({
          where: { userId: id },
          transaction: t,
        });

        if (existingApplication) {
          // Update existing application record but preserve status and timestamps
          const { status, submittedAt, reviewedAt, reviewedBy, ...updateData } =
            application;
          await existingApplication.update(updateData, { transaction: t });
          console.log("Updated existing application record for user:", id);
        } else {
          // Create new application record
          await CandidateApplication.create(
            {
              userId: candidate.id,
              ...application,
            },
            { transaction: t },
          );
          console.log("Created new application record for user:", id);
        }
      }
    });

    // Get updated candidate with role and application
    const updatedCandidate = await User.findOne({
      where: { id },
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
          model: Role,
          as: "role",
          attributes: ["id", "name"],
        },
        {
          model: CandidateApplication,
          as: "application",
          required: false,
        },
      ],
    });

    res.status(200).json({
      status: "success",
      message: "Candidate updated successfully",
      data: { candidate: updatedCandidate },
    });
  } catch (error) {
    console.error("Update Candidate Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
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
        data: null,
      });
    }

    // Soft delete by setting status to 'inactive'
    await candidate.update({ status: "inactive" });

    res.status(200).json({
      status: "success",
      message: "Candidate deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete Candidate Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
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
        data: null,
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        status: "error",
        message: "Passwords do not match",
        data: null,
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters long",
        data: null,
      });
    }

    const candidate = await User.findOne({ where: { id, role_id: 3 } });
    if (!candidate) {
      return res.status(404).json({
        status: "error",
        message: "Candidate not found",
        data: null,
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    await candidate.update({
      password: hashedPassword,
      temp_password: null,
      password_reset_otp: null,
      password_reset_otp_expiry: null,
    });

    res.status(200).json({
      status: "success",
      message: "Password reset successfully",
      data: null,
    });
  } catch (error) {
    console.error("Reset Candidate Password Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
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
        data: null,
      });
    }

    // Toggle status between active and inactive
    const newStatus = candidate.status === "active" ? "inactive" : "active";
    await candidate.update({ status: newStatus });

    res.status(200).json({
      status: "success",
      message: `Candidate ${newStatus === "active" ? "activated" : "deactivated"} successfully`,
      data: {
        candidate_id: candidate.id,
        status: newStatus,
      },
    });
  } catch (error) {
    console.error("Toggle Candidate Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Export Candidates to CSV
export const exportCandidates = async (req, res) => {
  try {
    const { search, status, visaType, paymentStatus } = req.query;

    const whereClause = {
      role_id: 3, // Candidate role
    };

    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    // Build include clause for filtering by visa type and payment status
    const includeClause = [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
      },
      {
        model: CandidateApplication,
        as: "application",
        required: false,
        attributes: ["id", "userId", "status", "submittedAt", "visaType"]
      },
    ];

    const caseWhere = {};

    if (visaType) {
      caseWhere.visaTypeId = visaType;
    }

    if (paymentStatus) {
      if (paymentStatus === "Paid") {
        caseWhere.paidAmount = { [Op.col]: "totalAmount" };
      } else if (paymentStatus === "Partial") {
        caseWhere.paidAmount = {
          [Op.gt]: 0,
          [Op.lt]: db.sequelize.col("totalAmount"),
        };
      } else if (paymentStatus === "Outstanding") {
        caseWhere.paidAmount = 0;
      }
    }

    if (Object.keys(caseWhere).length > 0) {
      includeClause.push({
        model: db.Case,
        as: "cases",
        where: caseWhere,
        required: true,
        attributes: [],
      });
    }


    // Filtering by visa type and payment status temporarily disabled to fix 500 error
    // TODO: Re-enable after Case associations are properly configured

    const candidates = await User.findAll({
      where: whereClause,
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
      include: includeClause,
      order: [["createdAt", "DESC"]],
    });

    // Generate CSV with application fields
    const csvHeader = [
      "ID",
      "First Name",
      "Last Name",
      "Email",
      "Country Code",
      "Mobile",
      "Role",
      "Status",
      "Created At",
      "Application Type",
      "Gender",
      "Relationship Status",
      "Address",
      "Nationality",
      "Birth Country",
      "Place of Birth",
      "DOB",
      "Passport Number",
      "Issuing Authority",
      "Issue Date",
      "Expiry Date",
      "Visa Type",
      "BRP Number",
      "Visa Expiry Date",
      "NI Number",
      "Sponsored",
      "English Proof",
    ];
    const csvRows = candidates.map((candidate) => {
      const app = candidate.application || {};
      return [
        candidate.id,
        candidate.first_name,
        candidate.last_name,
        candidate.email,
        candidate.country_code,
        candidate.mobile,
        candidate.Role?.name || "N/A",
        candidate.status,
        candidate.createdAt.toISOString(),
        app.applicationType || "",
        app.gender || "",
        app.relationshipStatus || "",
        app.address || "",
        app.nationality || "",
        app.birthCountry || "",
        app.placeOfBirth || "",
        app.dob ? new Date(app.dob).toISOString().split("T")[0] : "",
        app.passportNumber || "",
        app.issuingAuthority || "",
        app.issueDate
          ? new Date(app.issueDate).toISOString().split("T")[0]
          : "",
        app.expiryDate
          ? new Date(app.expiryDate).toISOString().split("T")[0]
          : "",
        app.visaType || "",
        app.brpNumber || "",
        app.visaEndDate
          ? new Date(app.visaEndDate).toISOString().split("T")[0]
          : "",
        app.niNumber || "",
        app.sponsored || "",
        app.englishProof || "",
      ];
    });

    const csvContent = [
      csvHeader.join(","),
      ...csvRows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="candidates_export.csv"',
    );
    res.send(csvContent);
  } catch (error) {
    console.error("Export Candidates Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Bulk Import Candidates from CSV
export const bulkImportCandidates = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: "error",
        message: "No file uploaded",
        data: null,
      });
    }

    const csvData = req.file.buffer.toString("utf-8");
    const lines = csvData.split("\n").filter((line) => line.trim());

    if (lines.length < 2) {
      return res.status(400).json({
        status: "error",
        message: "CSV file is empty or has no data rows",
        data: null,
      });
    }

    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const results = {
      success: [],
      errors: [],
    };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i]
          .split(",")
          .map((v) => v.trim().replace(/"/g, ""));
        const rowData = {};

        headers.forEach((header, index) => {
          rowData[header] = values[index] || "";
        });

        // Generate password
        const generatedPassword =
          Math.random().toString(36).slice(-8) +
          Math.random().toString(36).slice(-4);
        const hashedPassword = await bcrypt.hash(generatedPassword, 12);

        const candidate = await User.create({
          first_name: rowData.first_name || rowData.firstName || "",
          last_name: rowData.last_name || rowData.lastName || "",
          email: rowData.email,
          country_code: rowData.country_code || rowData.countryCode || "+44",
          mobile: rowData.mobile,
          role_id: 3,
          password: hashedPassword,
          is_email_verified: true,
          is_otp_verified: true,
          status: "active",
        });

        // Create CandidateApplication record if application data exists
        if (
          rowData["Application Type"] ||
          rowData.gender ||
          rowData.nationality ||
          rowData.dob
        ) {
          await CandidateApplication.create({
            userId: candidate.id,
            applicationType: rowData["Application Type"] || "Single",
            gender: rowData.gender || null,
            relationshipStatus: rowData["Relationship Status"] || null,
            address: rowData.Address || null,
            nationality: rowData.Nationality || null,
            birthCountry: rowData["Birth Country"] || null,
            placeOfBirth: rowData["Place of Birth"] || null,
            dob: rowData.dob ? new Date(rowData.dob) : null,
            passportNumber: rowData["Passport Number"] || null,
            issuingAuthority: rowData["Issuing Authority"] || null,
            issueDate: rowData["Issue Date"]
              ? new Date(rowData["Issue Date"])
              : null,
            expiryDate: rowData["Expiry Date"]
              ? new Date(rowData["Expiry Date"])
              : null,
            visaType: rowData["Visa Type"] || null,
            brpNumber: rowData["BRP Number"] || null,
            visaEndDate: rowData["Visa Expiry Date"]
              ? new Date(rowData["Visa Expiry Date"])
              : null,
            niNumber: rowData["NI Number"] || null,
            sponsored: rowData.Sponsored || null,
            englishProof: rowData["English Proof"] || null,
            status: "submitted",
            submittedAt: new Date(),
          });
        }

        results.success.push({
          row: i + 1,
          id: candidate.id,
          email: candidate.email,
          temporary_password: generatedPassword,
        });
      } catch (error) {
        results.errors.push({
          row: i + 1,
          error: error.message,
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
        results,
      },
    });
  } catch (error) {
    console.error("Bulk Import Candidates Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
