import db from '../models/index.js';

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

// Check if user has specific permission
export const checkPermission = (permissionName) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      const roleId = req.user?.role_id;

      if (!userId || !roleId) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required.',
          data: null,
        });
      }

      // Get user's role with permissions
      const Role = db.Role;
      const Permission = db.Permission;

      const role = await Role.findByPk(roleId, {
        include: [
          {
            model: Permission,
            as: 'permissions',
          },
        ],
      });

      if (!role) {
        return res.status(403).json({
          status: 'error',
          message: 'Role not found.',
          data: null,
        });
      }

      const hasPermission = role.permissions?.some(
        (p) => p.name === permissionName
      );

      if (!hasPermission) {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied — insufficient permissions.',
          data: null,
        });
      }

      // Attach permissions to request for later use
      req.userPermissions = role.permissions;

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).json({
        status: 'error',
        message: 'Permission check failed.',
        data: null,
      });
    }
  };
};

// Check if user has any of the specified permissions
export const checkAnyPermission = (permissionNames) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      const roleId = req.user?.role_id;

      if (!userId || !roleId) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required.',
          data: null,
        });
      }

      const Role = db.Role;
      const Permission = db.Permission;

      const role = await Role.findByPk(roleId, {
        include: [
          {
            model: Permission,
            as: 'permissions',
          },
        ],
      });

      if (!role) {
        return res.status(403).json({
          status: 'error',
          message: 'Role not found.',
          data: null,
        });
      }

      const userPermissionNames = role.permissions?.map((p) => p.name) || [];
      const hasAnyPermission = permissionNames.some((p) =>
        userPermissionNames.includes(p)
      );

      if (!hasAnyPermission) {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied — insufficient permissions.',
          data: null,
        });
      }

      req.userPermissions = role.permissions;

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).json({
        status: 'error',
        message: 'Permission check failed.',
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