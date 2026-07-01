import logger from '../../../utils/logger.js';
import { getPaginationParams, buildPaginationMeta } from '../../../utils/paginate.js';
import { Op } from 'sequelize';

export const getSponsorAuditLogs = async (req, res) => {
  try {
    const organisationId = Number(req.user?.organisation_id);
    if (!organisationId) {
      return res.status(403).json({ status: 'error', message: 'Organisation context required' });
    }

    const { page, limit, offset } = getPaginationParams(req.query);
    const { action, entity_type, search, from, to } = req.query;

    const where = { organisation_id: organisationId };

    if (action) where.action = action;
    if (entity_type) where.entity_type = entity_type;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) where.created_at[Op.lte] = new Date(to);
    }
    if (search) {
      where[Op.or] = [
        { action: { [Op.iLike]: `%${search}%` } },
        { details: { [Op.iLike]: `%${search}%` } },
        { entity_type: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await req.tenantDb.AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      status: 'success',
      data: rows,
      pagination: buildPaginationMeta(count, page, limit),
    });
  } catch (err) {
    logger.error({ err }, 'getSponsorAuditLogs error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const getSponsorAuditActions = async (req, res) => {
  try {
    const organisationId = Number(req.user?.organisation_id);
    if (!organisationId) {
      return res.status(403).json({ status: 'error', message: 'Organisation context required' });
    }

    const rows = await req.tenantDb.AuditLog.findAll({
      where: { organisation_id: organisationId },
      attributes: [[req.tenantDb.AuditLog.sequelize.fn('DISTINCT', req.tenantDb.AuditLog.sequelize.col('action')), 'action']],
      raw: true,
    });

    return res.status(200).json({
      status: 'success',
      data: rows.map((r) => r.action).filter(Boolean).sort(),
    });
  } catch (err) {
    logger.error({ err }, 'getSponsorAuditActions error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
