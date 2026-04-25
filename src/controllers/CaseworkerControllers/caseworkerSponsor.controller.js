import db from "../../models/index.js";
import { Op } from "sequelize";
import { ROLES } from "../../middlewares/role.middleware.js";

const User = db.User;
const Role = db.Role;
const SponsorProfile = db.SponsorProfile;
const Case = db.Case;

// Get All Sponsors (Read-only for Caseworkers)
export const getAllSponsors = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, licenceStatus, riskLevel } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause - only active sponsors for caseworkers
    const whereClause = {
      role_id: 4, // Sponsor/Business role
      status: 'active' // Only show active sponsors to caseworkers
    };

    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Build include clause with SponsorProfile and case count
    const includeClause = [
      {
        model: Role,
        as: 'role',
        attributes: ['id', 'name']
      },
      {
        model: SponsorProfile,
        as: 'sponsorProfile',
        required: false
      }
    ];

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

    // Get active case count for each sponsor
    const sponsorsWithCaseCount = await Promise.all(
      sponsors.map(async (sponsor) => {
        const activeCasesCount = await Case.count({
          where: {
            sponsorId: sponsor.id,
            status: { [Op.notIn]: ['Approved', 'Rejected', 'Closed', 'Cancelled'] }
          }
        });

        const sponsoredWorkersCount = await Case.count({
          where: {
            sponsorId: sponsor.id
          }
        });

        return {
          ...sponsor.toJSON(),
          activeCases: activeCasesCount,
          sponsoredWorkers: sponsoredWorkersCount
        };
      })
    );

    res.status(200).json({
      status: "success",
      message: "Sponsors retrieved successfully",
      data: {
        sponsors: sponsorsWithCaseCount,
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

// Get Sponsor by ID (Read-only for Caseworkers)
export const getSponsorById = async (req, res) => {
  try {
    const { id } = req.params;

    const sponsor = await User.findOne({
      where: { id, role_id: 4, status: 'active' },
      attributes: { 
        exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] 
      },
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['id', 'name']
        },
        {
          model: SponsorProfile,
          as: 'sponsorProfile',
          required: false
        }
      ]
    });

    if (!sponsor) {
      return res.status(404).json({
        status: "error",
        message: "Sponsor not found",
        data: null
      });
    }

    // Get active cases for this sponsor
    const activeCases = await Case.findAll({
      where: {
        sponsorId: sponsor.id,
        status: { [Op.notIn]: ['Approved', 'Rejected', 'Closed', 'Cancelled'] }
      },
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        }
      ],
      limit: 10,
      order: [['created_at', 'DESC']]
    });

    // Get total sponsored workers count
    const sponsoredWorkersCount = await Case.count({
      where: { sponsorId: sponsor.id }
    });

    // Get active cases count
    const activeCasesCount = await Case.count({
      where: {
        sponsorId: sponsor.id,
        status: { [Op.notIn]: ['Approved', 'Rejected', 'Closed', 'Cancelled'] }
      }
    });

    res.status(200).json({
      status: "success",
      message: "Sponsor retrieved successfully",
      data: {
        sponsor: sponsor.toJSON(),
        activeCases,
        stats: {
          sponsoredWorkers: sponsoredWorkersCount,
          activeCases: activeCasesCount
        }
      }
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
};

export default {
  getAllSponsors,
  getSponsorById
};
