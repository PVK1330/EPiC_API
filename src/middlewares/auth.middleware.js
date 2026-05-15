import jwt from 'jsonwebtoken';
import db from '../models/index.js';
import { isSuperAdminRole } from '../utils/tenantScope.js';

export const verifyToken = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error('CRITICAL: JWT_SECRET environment variable is not configured');
      return res.status(500).json({
        status: 'error',
        message: 'Server configuration error',
        data: null,
      });
    }

    let token = null;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token && req.cookies) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required. No token provided.',
        data: null,
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const roleId = Number(decoded.role_id);

    let organisation_id =
      decoded.organisation_id !== undefined && decoded.organisation_id !== null
        ? Number(decoded.organisation_id)
        : null;

    if (!isSuperAdminRole(roleId)) {
      if (organisation_id == null || Number.isNaN(organisation_id)) {
        const u = await db.User.findByPk(decoded.userId, {
          attributes: ['organisation_id'],
        });
        organisation_id =
          u?.organisation_id != null ? Number(u.organisation_id) : null;
      }

      if (organisation_id == null || Number.isNaN(organisation_id)) {
        return res.status(403).json({
          status: 'error',
          message:
            'Your account is not assigned to an organisation. Contact your administrator.',
          data: null,
        });
      }
    } else {
      organisation_id =
        decoded.organisation_id != null ? Number(decoded.organisation_id) : null;
      if (Number.isNaN(organisation_id)) organisation_id = null;
    }

    req.user = {
      ...decoded,
      role_id: roleId,
      organisation_id,
    };

    next();
  } catch (err) {
    console.error('verifyToken - Error:', err.message);
    return res.status(401).json({
      status: 'error',
      message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid or expired token.',
      data: null,
    });
  }
};
