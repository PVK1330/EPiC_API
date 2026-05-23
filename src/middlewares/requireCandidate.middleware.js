import ApiResponse from '../utils/apiResponse.js';
import { ROLES } from './role.middleware.js';

/**
 * Specifically requires the Candidate role.
 */
export const requireCandidate = (req, res, next) => {
  if (req.user && req.user.role_id === ROLES.CANDIDATE) {
    return next();
  }
  return ApiResponse.forbidden(res, "Candidate access required");
};
