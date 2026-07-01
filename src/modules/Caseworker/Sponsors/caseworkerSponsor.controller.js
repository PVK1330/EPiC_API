import logger from '../../../utils/logger.js';
import { Op } from 'sequelize';
import { ROLES } from '../../../middlewares/role.middleware.js';
import { excludeSensitiveUserAttrs } from '../../../utils/userAttributes.js';

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
        model: req.tenantDb.Role,
        as: 'role',
        attributes: ['id', 'name']
      },
      {
        model: req.tenantDb.SponsorProfile,
        as: 'sponsorProfile',
        required: false
      }
    ];

    const { count, rows: sponsors } = await req.tenantDb.User.findAndCountAll({
      where: whereClause,
      attributes: excludeSensitiveUserAttrs(),
      include: includeClause,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Get active case count for each sponsor
    const sponsorsWithCaseCount = await Promise.all(
      sponsors.map(async (sponsor) => {
        const activeCasesCount = await req.tenantDb.Case.count({
          where: {
            sponsorId: sponsor.id,
            status: { [Op.notIn]: ['Approved', 'Rejected', 'Closed', 'Cancelled'] }
          }
        });

        const sponsoredWorkersCount = await req.tenantDb.Case.count({
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
    logger.error({ err: error }, "Get All Sponsors Error");
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

    const sponsor = await req.tenantDb.User.findOne({
      where: { id, role_id: 4, status: 'active' },
      attributes: excludeSensitiveUserAttrs(),
      include: [
        {
          model: req.tenantDb.Role,
          as: 'role',
          attributes: ['id', 'name']
        },
        {
          model: req.tenantDb.SponsorProfile,
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
    const activeCases = await req.tenantDb.Case.findAll({
      where: {
        sponsorId: sponsor.id,
        status: { [Op.notIn]: ['Approved', 'Rejected', 'Closed', 'Cancelled'] }
      },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name']
        }
      ],
      limit: 10,
      order: [['created_at', 'DESC']]
    });

    // Get total sponsored workers count
    const sponsoredWorkersCount = await req.tenantDb.Case.count({
      where: { sponsorId: sponsor.id }
    });

    // Get active cases count
    const activeCasesCount = await req.tenantDb.Case.count({
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
    logger.error({ err: error }, "Get Sponsor by ID Error");
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
