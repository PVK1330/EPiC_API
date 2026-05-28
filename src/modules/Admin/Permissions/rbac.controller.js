import { Op } from 'sequelize';


// Get RBAC overview - summary of roles, permissions, and assignments
export const getRbacOverview = async (req, res) => {
  try {
    const rolesCount = await req.tenantDb.Role.count();
    const permissionsCount = await req.tenantDb.Permission.count();
    const rolePermissionsCount = await req.tenantDb.RolePermission.count();
    const usersCount = await req.tenantDb.User.count();

    // Get users by role
    const usersByRole = await req.tenantDb.User.findAll({
      attributes: [
        [req.tenantDb.sequelize.col('role.id'), 'roleId'],
        [req.tenantDb.sequelize.col('role.name'), 'roleName'],
        [req.tenantDb.sequelize.fn('COUNT', req.tenantDb.sequelize.col('User.id')), 'userCount']
      ],
      include: [
        {
          model: req.tenantDb.Role,
          as: 'role',
          attributes: []
        }
      ],
      group: ['role.id', 'role.name'],
      raw: true
    });

    const usersByRoleData = usersByRole.map((role) => ({
      roleId: role.roleId,
      roleName: role.roleName,
      userCount: parseInt(role.userCount) || 0,
    }));

    // Get permissions by module
    const permissionsByModule = await req.tenantDb.Permission.findAll({
      attributes: ["module", [req.tenantDb.sequelize.fn("COUNT", req.tenantDb.sequelize.col("id")), "count"]],
      group: ["module"],
      order: [["module", "ASC"]],
    });

    const permissionsByModuleData = permissionsByModule.map((p) => ({
      module: p.module,
      count: parseInt(p.dataValues.count),
    }));

    // Get role permission counts
    const rolePermissionsCountData = await req.tenantDb.Role.findAll({
      attributes: ["id", "name"],
      include: [
        {
          model: req.tenantDb.Permission,
          as: "permissions",
          attributes: ["id"],
          through: { attributes: [] },
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
    logger.error({ err: error }, "Get RBAC Overview Error");
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
    const roles = await req.tenantDb.Role.findAll({
      order: [["id", "ASC"]],
    });

    const permissions = await req.tenantDb.Permission.findAll({
      order: [["module", "ASC"], ["action", "ASC"]],
    });

    const rolePermissions = await req.tenantDb.RolePermission.findAll();

    const matrix = roles.map((role) => {
      const rolePermIds = rolePermissions
        .filter((rp) => rp.role_id === role.id)
        .map((rp) => rp.permission_id);

      const rolePerms = permissions.map((perm) => ({
        permissionId: perm.id,
        permissionName: perm.name,
        module: perm.module,
        action: perm.action,
        resource: perm.resource,
        hasPermission: rolePermIds.includes(perm.id),
      }));

      return {
        roleId: role.id,
        roleName: role.name,
        permissions: rolePerms,
      };
    });

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
    logger.error({ err: error }, "Get RBAC Matrix Error");
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

    const users = await req.tenantDb.User.findAll({
      where: whereClause,
      attributes: {
        exclude: ["password", "otp_code", "otp_expiry", "password_reset_otp", "password_reset_otp_expiry", "temp_password"],
      },
      include: [
        {
          model: req.tenantDb.Role,
          as: "role",    // ← correct lowercase alias
          include: [
            {
              model: req.tenantDb.Permission,
              as: "permissions",
              through: { attributes: [] },
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const usersData = users.map((user) => {
      const groupedPermissions = user.role?.permissions?.reduce((acc, perm) => {
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
          id: user.role?.id,
          name: user.role?.name,
        },
        permissions: groupedPermissions,
        permissionModules: Object.keys(groupedPermissions),
        totalPermissions: user.role?.permissions?.length || 0,
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
    logger.error({ err: error }, "Get Users with Roles and Permissions Error");
    res.status(500).json({
      status: "error",
      message: "Failed to fetch users with roles and permissions",
      data: null,
      error: error.message,
    });
  }
};

// Get permission audit trail
export const getPermissionAudit = async (req, res) => {
  try {
    const { permissionId } = req.params;

    const permission = await req.tenantDb.Permission.findByPk(permissionId, {
      include: [
        {
          model: req.tenantDb.Role,
          as: "roles",
          through: { attributes: [] },
          include: [
            {
              model: req.tenantDb.User,
              as: "users",
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
      userCount: role.users?.length || 0,
      users: role.users?.map((user) => ({
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        status: user.status,
      })) || [],
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
    logger.error({ err: error }, "Get Permission Audit Error");
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
    const assignedPermissionIds = await req.tenantDb.RolePermission.findAll({
      attributes: [[req.tenantDb.sequelize.fn("DISTINCT", req.tenantDb.sequelize.col("permission_id")), "permission_id"]],
    });

    const assignedIds = assignedPermissionIds.map((rp) => rp.permission_id);

    const whereClause = assignedIds.length > 0
      ? { id: { [Op.notIn]: assignedIds } }
      : {};

    const orphanPermissions = await req.tenantDb.Permission.findAll({
      where: whereClause,
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
    logger.error({ err: error }, "Get Orphan Permissions Error");
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
    const roles = await req.tenantDb.Role.findAll({
      include: [
        {
          model: req.tenantDb.Permission,
          as: "permissions",
          through: { attributes: [] },
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
    logger.error({ err: error }, "Get Roles Without Permissions Error");
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
  const t = await req.tenantDb.sequelize.transaction();
  try {
    const { roleIds, permissionIds } = req.body;

    if (!roleIds || !Array.isArray(roleIds) || roleIds.length === 0) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "roleIds array is required",
        data: null,
      });
    }

    if (!permissionIds || !Array.isArray(permissionIds) || permissionIds.length === 0) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "permissionIds array is required",
        data: null,
      });
    }

    // Validate all role IDs are integers
    if (!roleIds.every((id) => Number.isInteger(Number(id)))) {
      await t.rollback();
      return res.status(400).json({
        status: "error",
        message: "roleIds must be integers",
        data: null,
      });
    }

    const roles = await req.tenantDb.Role.findAll({
      where: { id: { [Op.in]: roleIds } },
      transaction: t,
    });

    if (roles.length !== roleIds.length) {
      await t.rollback();
      return res.status(404).json({
        status: "error",
        message: "One or more roles not found",
        data: null,
      });
    }

    const permissions = await req.tenantDb.Permission.findAll({
      where: { id: { [Op.in]: permissionIds } },
      transaction: t,
    });

    if (permissions.length !== permissionIds.length) {
      await t.rollback();
      return res.status(404).json({
        status: "error",
        message: "One or more permissions not found",
        data: null,
      });
    }

    await req.tenantDb.RolePermission.destroy({
      where: { role_id: { [Op.in]: roleIds } },
      transaction: t,
    });

    const rolePermissions = [];
    for (const roleId of roleIds) {
      for (const permissionId of permissionIds) {
        rolePermissions.push({
          role_id: Number(roleId),
          permission_id: Number(permissionId),
        });
      }
    }

    await req.tenantDb.RolePermission.bulkCreate(rolePermissions, { transaction: t });
    await t.commit();

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
    await t.rollback();
    logger.error({ err: error }, "Bulk Assign Permissions Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
