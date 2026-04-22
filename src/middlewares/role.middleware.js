import db from '../models/index.js';

// Simple in-memory cache for role permissions
const permissionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedPermissions(roleId) {
  const cached = permissionCache.get(roleId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.permissions;
  }
  return null;
}

function setCachedPermissions(roleId, permissions) {
  permissionCache.set(roleId, {
    permissions,
    timestamp: Date.now()
  });
}

function clearPermissionCache(roleId) {
  if (roleId) {
    permissionCache.delete(roleId);
  } else {
    permissionCache.clear();
  }
}

export { clearPermissionCache };

export const checkRole = (allowedRoleIds) => {
  return (req, res, next) => {
    try {
      const userRoleId = req.user?.role_id;

      // Handle both single role ID and array of role IDs
      const allowedIds = Array.isArray(allowedRoleIds) ? allowedRoleIds : [allowedRoleIds];

      if (!allowedIds.includes(userRoleId)) {
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

      // Check cache first
      let permissions = getCachedPermissions(roleId);
      
      if (!permissions) {
        // Get user's role with permissions from database
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

        permissions = role.permissions;
        setCachedPermissions(roleId, permissions);
      }

      const hasPermission = permissions?.some(
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

      // Check cache first
      let permissions = getCachedPermissions(roleId);
      
      if (!permissions) {
        // Get user's role with permissions from database
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

        permissions = role.permissions;
        setCachedPermissions(roleId, permissions);
      }

      const userPermissionNames = permissions?.map((p) => p.name) || [];
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

      req.userPermissions = permissions;

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