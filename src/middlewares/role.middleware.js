export const checkRole = (allowedRoleIds) => {
  return (req, res, next) => {
    try {
      const userRoleId = req.user?.role_id;

      if (!allowedRoleIds.includes(userRoleId)) {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied — insufficient permissions.',
          data: null,
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({
        status: 'error',
        message: 'Role check failed.',
        data: null,
      });
    }
  };
};

// Role ID constants — import these in routes instead of hardcoding numbers
export const ROLES = {
  ADMIN: 1,
  CASEWORKER: 2,
  CANDIDATE: 3,
  BUSINESS: 4,
};