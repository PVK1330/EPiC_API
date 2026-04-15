import db from '../../models/index.js';

const { Role, Permission, RolePermission } = db;

/**
 * Create a new role
 */
export const createRole = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Role name is required',
      });
    }

    // Check if role already exists
    const existingRole = await Role.findOne({ where: { name } });
    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: 'Role with this name already exists',
      });
    }

    // Create role
    const role = await Role.create({
      name,
      description: description || '',
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: role,
    });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating role',
      error: error.message,
    });
  }
};

/**
 * Get all roles
 */
export const getAllRoles = async (req, res) => {
  try {
    const roles = await Role.findAll({
      order: [['id', 'ASC']],
    });

    res.status(200).json({
      success: true,
      data: roles,
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching roles',
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

    const role = await Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    res.status(200).json({
      success: true,
      data: role,
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching role',
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

    const role = await Role.findByPk(id, {
      include: [
        {
          model: Permission,
          through: { attributes: [] },
          as: 'permissions',
        },
      ],
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    res.status(200).json({
      success: true,
      data: role,
    });
  } catch (error) {
    console.error('Error fetching role with permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching role with permissions',
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

    const role = await Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Check if name already exists (if changing name)
    if (name && name !== role.name) {
      const existingRole = await Role.findOne({ where: { name } });
      if (existingRole) {
        return res.status(400).json({
          success: false,
          message: 'Role with this name already exists',
        });
      }
    }

    // Update role
    await role.update({
      name: name || role.name,
      description: description !== undefined ? description : role.description,
    });

    res.status(200).json({
      success: true,
      message: 'Role updated successfully',
      data: role,
    });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating role',
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

    const role = await Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Prevent deletion of default roles (1, 2, 3, 4)
    if ([1, 2, 3, 4].includes(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete default system roles',
      });
    }

    // Delete role (this will cascade delete role-permission associations)
    await role.destroy();

    res.status(200).json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting role',
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
        success: false,
        message: 'permissionIds array is required',
      });
    }

    const role = await Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Get permissions
    const permissions = await Permission.findAll({
      where: { id: permissionIds },
    });

    if (permissions.length !== permissionIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more permissions not found',
      });
    }

    // Assign permissions to role
    await role.setPermissions(permissions);

    res.status(200).json({
      success: true,
      message: 'Permissions assigned to role successfully',
      data: {
        roleId: role.id,
        roleName: role.name,
        permissionCount: permissions.length,
      },
    });
  } catch (error) {
    console.error('Error assigning permissions to role:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning permissions to role',
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

    const role = await Role.findByPk(id, {
      include: [
        {
          model: Permission,
          through: { attributes: [] },
          as: 'permissions',
        },
      ],
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    res.status(200).json({
      success: true,
      data: role.permissions,
    });
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching role permissions',
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

    const role = await Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    const permission = await Permission.findByPk(permissionId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found',
      });
    }

    // Remove permission from role
    await role.removePermission(permission);

    res.status(200).json({
      success: true,
      message: 'Permission removed from role successfully',
    });
  } catch (error) {
    console.error('Error removing permission from role:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing permission from role',
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
        success: false,
        message: 'sourceRoleId and targetRoleId are required',
      });
    }

    const sourceRole = await Role.findByPk(sourceRoleId, {
      include: [
        {
          model: Permission,
          through: { attributes: [] },
          as: 'permissions',
        },
      ],
    });

    const targetRole = await Role.findByPk(targetRoleId);

    if (!sourceRole) {
      return res.status(404).json({
        success: false,
        message: 'Source role not found',
      });
    }

    if (!targetRole) {
      return res.status(404).json({
        success: false,
        message: 'Target role not found',
      });
    }

    // Clone permissions
    await targetRole.setPermissions(sourceRole.permissions);

    res.status(200).json({
      success: true,
      message: 'Permissions cloned successfully',
      data: {
        sourceRole: sourceRole.name,
        targetRole: targetRole.name,
        permissionCount: sourceRole.permissions.length,
      },
    });
  } catch (error) {
    console.error('Error cloning role permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Error cloning role permissions',
      error: error.message,
    });
  }
};
