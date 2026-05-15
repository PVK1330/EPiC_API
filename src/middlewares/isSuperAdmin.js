export const isSuperAdmin = (req, res, next) => {
  const rid = Number(req.user?.role_id);
  if (req.user && (rid === 5 || req.user.role === 'superadmin' || req.user.role_name === 'superadmin')) {
    next();
  } else {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. SuperAdmin privileges required.',
      data: null,
    });
  }
};
