import { Op } from "sequelize";
import db from "../../../models/index.js";
import { ROLES } from "../../../middlewares/role.middleware.js";

const User = db.User;
const Role = db.Role;
const VisaType = db.VisaType;

function getUserId(req) {
  return req.user?.userId ?? req.user?.id;
}

async function requireAdmin(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ status: "error", message: "Authentication required.", data: null });
    return null;
  }
  const user = await User.findOne({
    where: { id: userId, role_id: ROLES.ADMIN },
    include: [{ model: Role, as: 'role', attributes: ["id", "name"] }],
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
    const rows = await VisaType.findAll({ order: [["sort_order", "ASC"], ["id", "ASC"]] });
    res.status(200).json({
      status: "success",
      message: "Visa types retrieved.",
      data: { visa_types: rows.map((r) => ({ id: r.id, name: r.name, sort_order: r.sort_order })) },
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
    const existing = await VisaType.findOne({
      where: db.sequelize.where(
        db.sequelize.fn("LOWER", db.sequelize.fn("TRIM", db.sequelize.col("name"))),
        name.toLowerCase()
      ),
    });
    if (existing) {
      return res.status(400).json({ status: "error", message: "A visa type with this name already exists", data: null });
    }
    const maxOrder = await VisaType.max("sort_order");
    const sort_order = (maxOrder ?? 0) + 1;
    const row = await VisaType.create({ name, sort_order });
    res.status(201).json({
      status: "success",
      message: "Visa type created.",
      data: { visa_type: { id: row.id, name: row.name, sort_order: row.sort_order } },
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
    const row = await VisaType.findByPk(id);
    if (!row) {
      return res.status(404).json({ status: "error", message: "Visa type not found", data: null });
    }
    const duplicate = await VisaType.findOne({
      where: {
        [Op.and]: [
          { id: { [Op.ne]: id } },
          db.sequelize.where(
            db.sequelize.fn("LOWER", db.sequelize.fn("TRIM", db.sequelize.col("name"))),
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
      data: { visa_type: { id: row.id, name: row.name, sort_order: row.sort_order } },
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
    const row = await VisaType.findByPk(id);
    if (!row) {
      return res.status(404).json({ status: "error", message: "Visa type not found", data: null });
    }
    await row.destroy();
    res.status(200).json({ status: "success", message: "Visa type deleted.", data: null });
  } catch (error) {
    console.error("deleteVisaType error:", error);
    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });
  }
};