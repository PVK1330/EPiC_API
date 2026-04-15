import db from "../../models/index.js";
import { Op } from "sequelize";

const User = db.User;
const Role = db.Role;
const Permission = db.Permission;
const RolePermission = db.RolePermission;

// Get RBAC overview - summary of roles, permissions, and assignments
export const getRbacOverview = async (req, res) => {
  try {
    const rolesCount = await Role.count();
    const permissionsCount = await Permission.count();
    const rolePermissionsCount = await RolePermission.count();
    const usersCount = await User.count();

    // Get users by role
    const usersByRole = await Role.findAll({
      attributes: ["id", "name"],
      include: [
        {
          model: User,
          attributes: ["id"],
        },
      ],
    });

    const usersByRoleData = usersByRole.map((role) => ({
      roleId: role.id,
      roleName: role.name,
      userCount: role.Users?.length || 0,
    }));

    // Get permissions by module
    const permissionsByModule = await Permission.findAll({
      attributes: ["module", [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"]],
      group: ["module"],
      order: [["module", "ASC"]],
    });

    const permissionsByModuleData = permissionsByModule.map((p) => ({
      module: p.module,
      count: parseInt(p.dataValues.count),
    }));

    // Get role permissions count
    const rolePermissionsCountData = await Role.findAll({
      attributes: ["id", "name"],
      include: [
        {
          model: Permission,
          as: "permissions",
          attributes: ["id"],
        },
      ],
    });

    const rolePermissionsData = rolePermissionsCountData.map((role) => ({
      roleId: role.id,
      roleName: role.name,
      permissionCount: role.permissions?.length || 0,
    }));

    res.status(200).json({
      status: "success",
      message: "RBAC overview retrieved successfully",
      data: {
        summary: {
          totalRoles: rolesCount,
          totalPermissions: permissionsCount,
          totalRolePermissions: rolePermissionsCount,
          totalUsers: usersCount,
        },
        usersByRole: usersByRoleData,
        permissionsByModule: permissionsByModuleData,
        rolePermissions: rolePermissionsData,
      },
    });
  } catch (error) {
    console.error("Get RBAC Overview Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get detailed RBAC matrix - shows which roles have which permissions
export const getRbacMatrix = async (req, res) => {
  try {
    const roles = await Role.findAll({
      order: [["id", "ASC"]],
    });

    const permissions = await Permission.findAll({
      order: [["module", "ASC"], ["action", "ASC"]],
    });

    // Get all role permissions
    const rolePermissions = await RolePermission.findAll();

    // Build matrix
    const matrix = roles.map((role) => {
      const rolePermIds = rolePermissions
        .filter((rp) => rp.role_id === role.id)
        .map((rp) => rp.permission_id);

      const rolePerms = permissions.map((perm) => ({
        permissionId: perm.id,
        permissionName: perm.name,
        module: perm.module,
        action: perm.action,
        hasPermission: rolePermIds.includes(perm.id),
      }));

      return {
        roleId: role.id,
        roleName: role.name,
        permissions: rolePerms,
      };
    });

    // Group permissions by module
    const modules = [...new Set(permissions.map((p) => p.module))];

    res.status(200).json({
      status: "success",
      message: "RBAC matrix retrieved successfully",
      data: {
        roles: matrix,
        modules,
        totalRoles: roles.length,
        totalPermissions: permissions.length,
      },
    });
  } catch (error) {
    console.error("Get RBAC Matrix Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get users with their roles and permissions
export const getUsersWithRolesAndPermissions = async (req, res) => {
  try {
    const { role, search } = req.query;
    const whereClause = {};

    if (role) {
      whereClause.role_id = role;
    }

    if (search) {
      whereClause[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const users = await User.findAll({
      where: whereClause,
      attributes: {
        exclude: ["password", "otp_code", "otp_expiry", "password_reset_otp", "password_reset_otp_expiry", "temp_password"],
      },
      include: [
        {
          model: Role,
          attributes: ["id", "name"],
          include: [
            {
              model: Permission,
              as: "permissions",
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const usersData = users.map((user) => {
      const groupedPermissions = user.Role?.permissions?.reduce((acc, perm) => {
        if (!acc[perm.module]) {
          acc[perm.module] = [];
        }
        acc[perm.module].push(perm);
        return acc;
      }, {}) || {};

      return {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        status: user.status,
        role: {
          id: user.Role?.id,
          name: user.Role?.name,
        },
        permissions: groupedPermissions,
        permissionModules: Object.keys(groupedPermissions),
        totalPermissions: user.Role?.permissions?.length || 0,
      };
    });

    res.status(200).json({
      status: "success",
      message: "Users with roles and permissions retrieved successfully",
      data: {
        users: usersData,
        total: users.length,
      },
    });
  } catch (error) {
    console.error("Get Users with Roles and Permissions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get permission audit trail - who has what permissions
export const getPermissionAudit = async (req, res) => {
  try {
    const { permissionId } = req.params;

    const permission = await Permission.findByPk(permissionId, {
      include: [
        {
          model: Role,
          as: "roles",
          include: [
            {
              model: User,
              attributes: ["id", "first_name", "last_name", "email", "status"],
            },
          ],
        },
      ],
    });

    if (!permission) {
      return res.status(404).json({
        status: "error",
        message: "Permission not found",
        data: null,
      });
    }

    const auditData = permission.roles.map((role) => ({
      roleId: role.id,
      roleName: role.name,
      userCount: role.Users?.length || 0,
      users: role.Users?.map((user) => ({
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        status: user.status,
      })),
    }));

    res.status(200).json({
      status: "success",
      message: "Permission audit retrieved successfully",
      data: {
        permission: {
          id: permission.id,
          name: permission.name,
          description: permission.description,
          module: permission.module,
          action: permission.action,
        },
        assignedTo: auditData,
        totalRoles: permission.roles.length,
        totalUsers: auditData.reduce((sum, role) => sum + role.userCount, 0),
      },
    });
  } catch (error) {
    console.error("Get Permission Audit Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get orphan permissions - permissions not assigned to any role
export const getOrphanPermissions = async (req, res) => {
  try {
    const assignedPermissionIds = await RolePermission.findAll({
      attributes: [[db.sequelize.fn("DISTINCT", db.sequelize.col("permission_id")), "permission_id"]],
    });

    const assignedIds = assignedPermissionIds.map((rp) => rp.permission_id);

    const orphanPermissions = await Permission.findAll({
      where: {
        id: {
          [Op.notIn]: assignedIds,
        },
      },
      order: [["module", "ASC"], ["action", "ASC"]],
    });

    res.status(200).json({
      status: "success",
      message: "Orphan permissions retrieved successfully",
      data: {
        permissions: orphanPermissions,
        total: orphanPermissions.length,
      },
    });
  } catch (error) {
    console.error("Get Orphan Permissions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get roles without specific permissions
export const getRolesWithoutPermissions = async (req, res) => {
  try {
    const roles = await Role.findAll({
      include: [
        {
          model: Permission,
          as: "permissions",
        },
      ],
    });

    const rolesWithoutPerms = roles
      .filter((role) => !role.permissions || role.permissions.length === 0)
      .map((role) => ({
        id: role.id,
        name: role.name,
        permissionCount: 0,
      }));

    res.status(200).json({
      status: "success",
      message: "Roles without permissions retrieved successfully",
      data: {
        roles: rolesWithoutPerms,
        total: rolesWithoutPerms.length,
      },
    });
  } catch (error) {
    console.error("Get Roles Without Permissions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Bulk assign permissions to multiple roles
export const bulkAssignPermissions = async (req, res) => {
  try {
    const { roleIds, permissionIds } = req.body;

    if (!roleIds || !Array.isArray(roleIds) || roleIds.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "roleIds array is required",
        data: null,
      });
    }

    if (!permissionIds || !Array.isArray(permissionIds) || permissionIds.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "permissionIds array is required",
        data: null,
      });
    }

    // Verify all roles exist
    const roles = await Role.findAll({
      where: { id: { [Op.in]: roleIds } },
    });

    if (roles.length !== roleIds.length) {
      return res.status(404).json({
        status: "error",
        message: "One or more roles not found",
        data: null,
      });
    }

    // Verify all permissions exist
    const permissions = await Permission.findAll({
      where: { id: { [Op.in]: permissionIds } },
    });

    if (permissions.length !== permissionIds.length) {
      return res.status(404).json({
        status: "error",
        message: "One or more permissions not found",
        data: null,
      });
    }

    // Remove existing role permissions for these roles
    await RolePermission.destroy({
      where: { role_id: { [Op.in]: roleIds } },
    });

    // Create new role permissions
    const rolePermissions = [];
    for (const roleId of roleIds) {
      for (const permissionId of permissionIds) {
        rolePermissions.push({
          role_id: roleId,
          permission_id: permissionId,
        });
      }
    }

    await RolePermission.bulkCreate(rolePermissions);

    res.status(200).json({
      status: "success",
      message: "Permissions bulk assigned successfully",
      data: {
        rolesUpdated: roleIds.length,
        permissionsAssigned: permissionIds.length,
        totalAssignments: rolePermissions.length,
      },
    });
  } catch (error) {
    console.error("Bulk Assign Permissions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

