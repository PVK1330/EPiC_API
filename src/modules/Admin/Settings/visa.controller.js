import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import { ROLES } from '../../../middlewares/role.middleware.js';

function mapVisaType(row) {
  const plain = row?.get ? row.get({ plain: true }) : row;
  const templatePath = plain.ccl_template_path ?? plain.cclTemplatePath ?? null;
  const templateName = plain.ccl_template_name ?? plain.cclTemplateName ?? null;
  return {
    id: plain.id,
    name: plain.name,
    sort_order: plain.sort_order,
    ccl_template_path: templatePath,
    ccl_template_name: templateName,
    cclTemplatePath: templatePath,
    cclTemplateName: templateName,
  };
}

function deleteTemplateFileIfExists(filePath) {
  if (!filePath) return;
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('uploads/ccl-templates/')) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('deleteTemplateFileIfExists:', err.message);
  }
}

function getUserId(req) {
  return req.user?.userId ?? req.user?.id;
}

async function requireAdmin(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ status: "error", message: "Authentication required.", data: null });
    return null;
  }
  const user = await req.tenantDb.User.findOne({
    where: { id: userId, role_id: ROLES.ADMIN },
    include: [{ model: req.tenantDb.Role, as: 'role', attributes: ["id", "name"] }],
  });
  if (!user) {
    res.status(403).json({ status: "error", message: "Admin access required.", data: null });
    return null;
  }
  return user;
}

/** Visa types */
export const listVisaTypes = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const rows = await req.tenantDb.VisaType.findAll({ order: [["sort_order", "ASC"], ["id", "ASC"]] });
    res.status(200).json({
      status: "success",
      message: "Visa types retrieved.",
      data: { visa_types: rows.map(mapVisaType) },
    });
  } catch (error) {
    console.error("listVisaTypes error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};

export const createVisaType = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ status: "error", message: "Name is required", data: null });
    }
    const existing = await req.tenantDb.VisaType.findOne({
      where: req.tenantDb.sequelize.where(
        req.tenantDb.sequelize.fn("LOWER", req.tenantDb.sequelize.fn("TRIM", req.tenantDb.sequelize.col("name"))),
        name.toLowerCase()
      ),
    });
    if (existing) {
      return res.status(400).json({ status: "error", message: "A visa type with this name already exists", data: null });
    }
    const maxOrder = await req.tenantDb.VisaType.max("sort_order");
    const sort_order = (maxOrder ?? 0) + 1;
    const row = await req.tenantDb.VisaType.create({ name, sort_order });
    res.status(201).json({
      status: "success",
      message: "Visa type created.",
      data: { visa_type: mapVisaType(row) },
    });
  } catch (error) {
    console.error("createVisaType error:", error);
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).json({ status: "error", message: "A visa type with this name already exists", data: null });
    }
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};

export const updateVisaType = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ status: "error", message: "Name is required", data: null });
    }
    const row = await req.tenantDb.VisaType.findByPk(id);
    if (!row) {
      return res.status(404).json({ status: "error", message: "Visa type not found", data: null });
    }
    const duplicate = await req.tenantDb.VisaType.findOne({
      where: {
        [Op.and]: [
          { id: { [Op.ne]: id } },
          req.tenantDb.sequelize.where(
            req.tenantDb.sequelize.fn("LOWER", req.tenantDb.sequelize.fn("TRIM", req.tenantDb.sequelize.col("name"))),
            name.toLowerCase()
          ),
        ],
      },
    });
    if (duplicate) {
      return res.status(400).json({ status: "error", message: "A visa type with this name already exists", data: null });
    }
    await row.update({ name });
    res.status(200).json({
      status: "success",
      message: "Visa type updated.",
      data: { visa_type: mapVisaType(row) },
    });
  } catch (error) {
    console.error("updateVisaType error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};

export const deleteVisaType = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    const row = await req.tenantDb.VisaType.findByPk(id);
    if (!row) {
      return res.status(404).json({ status: "error", message: "Visa type not found", data: null });
    }
    deleteTemplateFileIfExists(row.cclTemplatePath);
    await row.destroy();
    res.status(200).json({ status: "success", message: "Visa type deleted.", data: null });
  } catch (error) {
    console.error("deleteVisaType error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};

// Get visa types for dropdown (no pagination, accessible by authenticated users)
export const dropdownVisaType = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Authentication required.", data: null });
    }
    const rows = await req.tenantDb.VisaType.findAll({
      order: [["sort_order", "ASC"], ["id", "ASC"]],
    });
    res.status(200).json({
      status: "success",
      message: "Visa types retrieved.",
      data: { visa_types: rows.map(mapVisaType) },
    });
  } catch (error) {
    console.error("dropdownVisaType error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};

export const uploadCclTemplate = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "No file uploaded", data: null });
    }

    const row = await req.tenantDb.VisaType.findByPk(id);
    if (!row) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ status: "error", message: "Visa type not found", data: null });
    }

    deleteTemplateFileIfExists(row.cclTemplatePath);

    const storedPath = req.file.path.replace(/\\/g, "/");
    const displayName = path.basename(req.file.originalname);

    await row.update({
      cclTemplatePath: storedPath,
      cclTemplateName: displayName,
    });
    await row.reload();

    res.status(200).json({
      status: "success",
      message: "CCL template uploaded.",
      data: { visa_type: mapVisaType(row) },
    });
  } catch (error) {
    console.error("uploadCclTemplate error:", error);
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};

export const deleteCclTemplate = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id", data: null });
    }

    const row = await req.tenantDb.VisaType.findByPk(id);
    if (!row) {
      return res.status(404).json({ status: "error", message: "Visa type not found", data: null });
    }

    deleteTemplateFileIfExists(row.cclTemplatePath);
    await row.update({ cclTemplatePath: null, cclTemplateName: null });
    await row.reload();

    res.status(200).json({
      status: "success",
      message: "CCL template removed.",
      data: { visa_type: mapVisaType(row) },
    });
  } catch (error) {
    console.error("deleteCclTemplate error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};