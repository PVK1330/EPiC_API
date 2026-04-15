import db from "../../models/index.js";
import { Op } from "sequelize";

const Permission = db.Permission;
const Role = db.Role;
const RolePermission = db.RolePermission;

// Get all permissions
export const getAllPermissions = async (req, res) => {
  try {
    const { module, search } = req.query;
    const whereClause = {};

    if (module) {
      whereClause.module = module;
    }

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const permissions = await Permission.findAll({
      where: whereClause,
      order: [["module", "ASC"], ["action", "ASC"]],
    });

    // Group by module
    const grouped = permissions.reduce((acc, perm) => {
      if (!acc[perm.module]) {
        acc[perm.module] = [];
      }
      acc[perm.module].push(perm);
      return acc;
    }, {});

    res.status(200).json({
      status: "success",
      message: "Permissions retrieved successfully",
      data: {
        permissions: grouped,
        modules: Object.keys(grouped),
        total: permissions.length,
      },
    });
  } catch (error) {
    console.error("Get All Permissions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get permission by ID
export const getPermissionById = async (req, res) => {
  try {
    const { id } = req.params;

    const permission = await Permission.findByPk(id, {
      include: [
        {
          model: Role,
          as: "roles",
          attributes: ["id", "name"],
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

    res.status(200).json({
      status: "success",
      message: "Permission retrieved successfully",
      data: { permission },
    });
  } catch (error) {
    console.error("Get Permission by ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Create permission
export const createPermission = async (req, res) => {
  try {
    const { name, description, module, action, resource } = req.body;

    if (!name || !module || !action) {
      return res.status(400).json({
        status: "error",
        message: "Name, module, and action are required",
        data: null,
      });
    }

    // Check if permission already exists
    const existingPermission = await Permission.findOne({ where: { name } });
    if (existingPermission) {
      return res.status(400).json({
        status: "error",
        message: "Permission with this name already exists",
        data: null,
      });
    }

    const permission = await Permission.create({
      name,
      description,
      module,
      action,
      resource,
    });

    res.status(201).json({
      status: "success",
      message: "Permission created successfully",
      data: { permission },
    });
  } catch (error) {
    console.error("Create Permission Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update permission
export const updatePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, module, action, resource } = req.body;

    const permission = await Permission.findByPk(id);
    if (!permission) {
      return res.status(404).json({
        status: "error",
        message: "Permission not found",
        data: null,
      });
    }

    // Check if name is being changed and if it already exists
    if (name && name !== permission.name) {
      const existingPermission = await Permission.findOne({
        where: { name, id: { [Op.ne]: id } },
      });
      if (existingPermission) {
        return res.status(400).json({
          status: "error",
          message: "Permission with this name already exists",
          data: null,
        });
      }
    }

    const updateData = {
      name: name || permission.name,
      description: description !== undefined ? description : permission.description,
      module: module || permission.module,
      action: action || permission.action,
      resource: resource !== undefined ? resource : permission.resource,
    };

    await permission.update(updateData);

    const updatedPermission = await Permission.findByPk(id, {
      include: [
        {
          model: Role,
          as: "roles",
          attributes: ["id", "name"],
        },
      ],
    });

    res.status(200).json({
      status: "success",
      message: "Permission updated successfully",
      data: { permission: updatedPermission },
    });
  } catch (error) {
    console.error("Update Permission Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Delete permission
export const deletePermission = async (req, res) => {
  try {
    const { id } = req.params;

    const permission = await Permission.findByPk(id);
    if (!permission) {
      return res.status(404).json({
        status: "error",
        message: "Permission not found",
        data: null,
      });
    }

    // Delete role permissions associated with this permission
    await RolePermission.destroy({ where: { permission_id: id } });

    await permission.destroy();

    res.status(200).json({
      status: "success",
      message: "Permission deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete Permission Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};


// Check if user has specific permission
export const checkUserPermission = async (req, res) => {
  try {
    const { permission } = req.query;
    const userId = req.user.userId;

    if (!permission) {
      return res.status(400).json({
        status: "error",
        message: "Permission parameter is required",
        data: null,
      });
    }

    const user = await db.User.findByPk(userId, {
      include: [
        {
          model: Role,
          include: [
            {
              model: Permission,
              as: "permissions",
            },
          ],
        },
      ],
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null,
      });
    }

    const hasPermission = user.Role?.permissions?.some(
      (p) => p.name === permission
    );

    res.status(200).json({
      status: "success",
      message: "Permission check completed",
      data: {
        hasPermission,
        permission,
        userId,
        role: user.Role?.name,
      },
    });
  } catch (error) {
    console.error("Check User Permission Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
