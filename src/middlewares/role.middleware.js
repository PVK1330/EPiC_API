exports.checkRole = (roles) => {
  return (req, res, next) => {
    try {
      const userRole = req.user.role_id;

      if (!roles.includes(userRole)) {
        return res.status(403).json({
          message: "Access denied",
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
};