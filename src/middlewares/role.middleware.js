exports.checkRole = (roles) => {
  return (req, res, next) => {
    try {
      const userRole = req.user.role_id;

      if (!roles.includes(userRole)) {
        return res.status(403).json({
          status: "error",
          message: "Access denied - insufficient permissions",
          data: {
            required_roles: roles,
            user_role: userRole
          }
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({ 
        status: "error",
        message: "Role check failed",
        error: err.message 
      });
    }
  };
};

// Helper function to check if user has specific role
exports.hasRole = (role) => {
  return (req, res, next) => {
    try {
      const userRole = req.user.role_id;

      if (userRole !== role) {
        return res.status(403).json({
          status: "error",
          message: "Access denied - insufficient permissions",
          data: {
            required_role: role,
            user_role: userRole
          }
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({ 
        status: "error",
        message: "Role check failed",
        error: err.message 
      });
    }
  };
};