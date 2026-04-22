import db from '../models/index.js';

export const ROLES = {
  ADMIN: 1,
  CASEWORKER: 2,
  CANDIDATE: 3,
  BUSINESS: 4,
};

function normalizeRoleId(roleId) {
  if (roleId === undefined || roleId === null) return null;
  const n = Number(roleId);
  return Number.isNaN(n) ? null : n;
}

function isAdminRole(roleId) {
  return normalizeRoleId(roleId) === ROLES.ADMIN;
}

export const checkRole = (allowedRoleIds) => {
  return (req, res, next) => {
    try {
      const userRoleId = normalizeRoleId(req.user?.role_id);
      const allowedRaw = Array.isArray(allowedRoleIds) ? allowedRoleIds : [allowedRoleIds];
      const allowedIds = allowedRaw.map((id) => normalizeRoleId(id)).filter((id) => id !== null);

      if (userRoleId === null || !allowedIds.includes(userRoleId)) {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied - insufficient permissions.',
          data: null,
        });
      }

      next();
    } catch (err) {
      console.error('checkRole - Error:', err);
      return res.status(500).json({
        status: 'error',
        message: 'Role check failed.',
        data: null,
      });
    }
  };
};

export const checkPermission = (permissionName) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      const roleId = req.user?.role_id;

      if (!userId || roleId === undefined || roleId === null) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required.',
          data: null,
        });
      }

      if (isAdminRole(roleId)) {
        return next();
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

export const checkAnyPermission = (permissionNames) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      const roleId = req.user?.role_id;

      if (!userId || roleId === undefined || roleId === null) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required.',
          data: null,
        });
      }

      if (isAdminRole(roleId)) {
        return next();
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
