import { ROLES } from './role.middleware.js';

/**
 * Must run after verifyToken. Only users with candidate role_id may proceed.
 */
export const requireCandidate = (req, res, next) => {
  const roleId = Number(req.user?.role_id);
  if (roleId !== ROLES.CANDIDATE) {
    return res.status(403).json({
      status: 'error',
      message: 'Candidate access only.',
      data: null,
    });
  }
  next();
};
