import { Op } from 'sequelize';


/**
 * Create a new role
 */
export const createRole = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        status: 'error',
        message: 'Role name is required',
        data: null,
      });
    }

    const existingRole = await req.tenantDb.Role.findOne({ where: { name } });
    if (existingRole) {
      return res.status(400).json({
        status: 'error',
        message: 'Role with this name already exists',
        data: null,
      });
    }

    const role = await req.tenantDb.Role.create({
      name,
      description: description || '',
    });

    res.status(201).json({
      status: 'success',
      message: 'Role created successfully',
      data: { role },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error creating role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to create role',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Get all roles
 */
export const getAllRoles = async (req, res) => {
  try {
    const roles = await req.tenantDb.Role.findAll({
      include: [
        {
          model: req.tenantDb.Permission,
          as: 'permissions',
          attributes: ['id'],
          through: { attributes: [] },
        },
        {
          model: req.tenantDb.User,
          as: 'users',
          attributes: ['id'],
        },
      ],
      order: [['id', 'ASC']],
    });

    const rolesData = roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description || '',
      permissionCount: role.permissions?.length || 0,
      userCount: role.users?.length || 0,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));

    res.status(200).json({
      status: 'success',
      message: 'Roles retrieved successfully',
      data: rolesData,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching roles');
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch roles',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Get role by ID
 */
export const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await req.tenantDb.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Role retrieved successfully',
      data: { role },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch role',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Get role with permissions
 */
export const getRoleWithPermissions = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await req.tenantDb.Role.findByPk(id, {
      include: [
        {
          model: req.tenantDb.Permission,
          through: { attributes: [] },
          as: 'permissions',
        },
      ],
    });

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Role with permissions retrieved successfully',
      data: {
        id: role.id,
        name: role.name,
        description: role.description || '',
        permissions: role.permissions || [],
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching role with permissions');
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch role with permissions',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Update role
 */
export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const role = await req.tenantDb.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    if (name && name !== role.name) {
      const existingRole = await req.tenantDb.Role.findOne({ where: { name } });
      if (existingRole) {
        return res.status(400).json({
          status: 'error',
          message: 'Role with this name already exists',
          data: null,
        });
      }
    }

    await role.update({
      name: name || role.name,
      description: description !== undefined ? description : role.description,
    });

    res.status(200).json({
      status: 'success',
      message: 'Role updated successfully',
      data: { role },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to update role',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Delete role
 */
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await req.tenantDb.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    if ([1, 2, 3, 4].includes(parseInt(id))) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete default system roles',
        data: null,
      });
    }

    // Check if any users have this role
    const usersWithRole = await req.tenantDb.User.count({ where: { role_id: id } });
    if (usersWithRole > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot delete role — ${usersWithRole} user(s) are assigned to it. Reassign them first.`,
        data: null,
      });
    }

    await role.destroy();

    res.status(200).json({
      status: 'success',
      message: 'Role deleted successfully',
      data: null,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete role',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Assign permissions to a role
 */
export const assignPermissionsToRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissionIds } = req.body;

    if (!permissionIds || !Array.isArray(permissionIds)) {
      return res.status(400).json({
        status: 'error',
        message: 'permissionIds array is required',
        data: null,
      });
    }

    const role = await req.tenantDb.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    const permissions = await req.tenantDb.Permission.findAll({
      where: { id: permissionIds },
    });

    if (permissions.length !== permissionIds.length && permissionIds.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'One or more permissions not found',
        data: null,
      });
    }

    await role.setPermissions(permissions);

    res.status(200).json({
      status: 'success',
      message: 'Permissions assigned to role successfully',
      data: {
        roleId: role.id,
        roleName: role.name,
        permissionCount: permissions.length,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error assigning permissions to role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to assign permissions to role',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Get role permissions
 */
export const getRolePermissions = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await req.tenantDb.Role.findByPk(id, {
      include: [
        {
          model: req.tenantDb.Permission,
          through: { attributes: [] },
          as: 'permissions',
        },
      ],
    });

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Role permissions retrieved successfully',
      data: { permissions: role.permissions || [] },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching role permissions');
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch role permissions',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Remove permission from role
 */
export const removePermissionFromRole = async (req, res) => {
  try {
    const { id, permissionId } = req.params;

    const role = await req.tenantDb.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    const permission = await req.tenantDb.Permission.findByPk(permissionId);

    if (!permission) {
      return res.status(404).json({
        status: 'error',
        message: 'Permission not found',
        data: null,
      });
    }

    await role.removePermission(permission);

    res.status(200).json({
      status: 'success',
      message: 'Permission removed from role successfully',
      data: null,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error removing permission from role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to remove permission from role',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Clone role permissions to another role
 */
export const cloneRolePermissions = async (req, res) => {
  try {
    const { sourceRoleId, targetRoleId } = req.body;

    if (!sourceRoleId || !targetRoleId) {
      return res.status(400).json({
        status: 'error',
        message: 'sourceRoleId and targetRoleId are required',
        data: null,
      });
    }

    const sourceRole = await req.tenantDb.Role.findByPk(sourceRoleId, {
      include: [
        {
          model: req.tenantDb.Permission,
          through: { attributes: [] },
          as: 'permissions',
        },
      ],
    });

    const targetRole = await req.tenantDb.Role.findByPk(targetRoleId);

    if (!sourceRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Source role not found',
        data: null,
      });
    }

    if (!targetRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Target role not found',
        data: null,
      });
    }

    await targetRole.setPermissions(sourceRole.permissions);

    res.status(200).json({
      status: 'success',
      message: 'Permissions cloned successfully',
      data: {
        sourceRole: sourceRole.name,
        targetRole: targetRole.name,
        permissionCount: sourceRole.permissions.length,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error cloning role permissions');
    res.status(500).json({
      status: 'error',
      message: 'Failed to clone role permissions',
      data: null,
      error: error.message,
    });
  }
};

/**
 * Update a user's role
 */
export const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { roleId } = req.body;

    if (!roleId) {
      return res.status(400).json({
        status: 'error',
        message: 'roleId is required',
        data: null,
      });
    }

    const user = await req.tenantDb.User.findByPk(userId, {
      attributes: { exclude: ['password', 'otp_code', 'otp_expiry', 'password_reset_otp', 'password_reset_otp_expiry', 'temp_password'] },
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
        data: null,
      });
    }

    const role = await req.tenantDb.Role.findByPk(roleId);
    if (!role) {
      return res.status(404).json({
        status: 'error',
        message: 'Role not found',
        data: null,
      });
    }

    await user.update({ role_id: roleId });

    res.status(200).json({
      status: 'success',
      message: 'User role updated successfully',
      data: {
        userId: user.id,
        roleName: role.name,
        roleId: role.id,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating user role');
    res.status(500).json({
      status: 'error',
      message: 'Failed to update user role',
      data: null,
      error: error.message,
    });
  }
};
