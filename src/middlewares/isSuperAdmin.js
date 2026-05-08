export const isSuperAdmin = (req, res, next) => {
  // role_id 5 is superadmin
  if (req.user && (req.user.role_id === 5 || req.user.role === 'superadmin' || req.user.role_name === 'superadmin')) {
    next();
  } else {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. SuperAdmin privileges required.',
      data: null,
    });
  }
};
