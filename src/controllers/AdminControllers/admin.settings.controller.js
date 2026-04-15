import { Op } from "sequelize";

import bcrypt from "bcryptjs";

import db from "../../models/index.js";

import { ROLES } from "../../middlewares/role.middleware.js";



const User = db.User;

const Role = db.Role;

const AdminUserPreference = db.AdminUserPreference;

const VisaType = db.VisaType;

const CaseCategory = db.CaseCategory;

const EmailTemplateSetting = db.EmailTemplateSetting;

const SlaSetting = db.SlaSetting;



const EMAIL_TEMPLATE_KEYS = ["payment", "doc", "opened", "expiry", "welcome"];



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

    include: [{ model: Role, attributes: ["id", "name"] }],

  });

  if (!user) {

    res.status(403).json({ status: "error", message: "Admin access required.", data: null });

    return null;

  }

  return user;

}



async function getOrCreatePreferences(userId) {

  const [prefs] = await AdminUserPreference.findOrCreate({

    where: { user_id: userId },

    defaults: { user_id: userId },

  });

  return prefs;

}



function buildPhoneDisplay(countryCode, mobile) {

  const cc = (countryCode || "").trim();

  const m = (mobile || "").trim();

  if (!cc && !m) return "";

  return [cc, m].filter(Boolean).join(" ");

}



/** GET /me */

export const getMe = async (req, res) => {

  try {

    const user = await requireAdmin(req, res);

    if (!user) return;



    const prefs = await getOrCreatePreferences(user.id);



    const plain = user.toJSON();

    res.status(200).json({

      status: "success",

      message: "Settings loaded.",

      data: {

        profile: {

          first_name: plain.first_name,

          last_name: plain.last_name,

          email: plain.email,

          country_code: plain.country_code,

          mobile: plain.mobile,

          phone: buildPhoneDisplay(plain.country_code, plain.mobile),

          avatar_url: prefs.avatar_url || null,

          role_id: plain.role_id,

          role_name: plain.Role?.name || null,

        },

        preferences: {

          two_factor_enabled: prefs.two_factor_enabled,

          email_notifications: prefs.email_notifications,

          case_updates: prefs.case_updates,

          payment_alerts: prefs.payment_alerts,

          timezone: prefs.timezone,

          language: prefs.language,

          date_format: prefs.date_format,

          data_collection: prefs.data_collection,

        },

      },

    });

  } catch (error) {

    console.error("getMe settings error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



/** PATCH /me */

export const patchMe = async (req, res) => {

  try {

    const user = await requireAdmin(req, res);

    if (!user) return;



    const {

      first_name,

      last_name,

      email,

      country_code,

      mobile,

      avatar_url,

      two_factor_enabled,

      email_notifications,

      case_updates,

      payment_alerts,

      timezone,

      language,

      date_format,

      data_collection,

    } = req.body;



    const prefs = await getOrCreatePreferences(user.id);



    const profileUpdates = {};

    if (first_name !== undefined) profileUpdates.first_name = String(first_name).trim();

    if (last_name !== undefined) profileUpdates.last_name = String(last_name).trim();

    if (email !== undefined) {

      const nextEmail = String(email).trim().toLowerCase();

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(nextEmail)) {

        return res.status(400).json({ status: "error", message: "Invalid email format", data: null });

      }

      if (nextEmail !== user.email) {

        const taken = await User.findOne({ where: { email: nextEmail, id: { [Op.ne]: user.id } } });

        if (taken) {

          return res.status(400).json({ status: "error", message: "Email already in use", data: null });

        }

      }

      profileUpdates.email = nextEmail;

    }

    if (country_code !== undefined) profileUpdates.country_code = String(country_code).trim();

    if (mobile !== undefined) profileUpdates.mobile = String(mobile).trim();



    if (Object.keys(profileUpdates).length > 0) {

      if (profileUpdates.first_name === "" || profileUpdates.last_name === "") {

        return res.status(400).json({ status: "error", message: "First name and last name cannot be empty", data: null });

      }

      if (profileUpdates.country_code === "" || profileUpdates.mobile === "") {

        return res.status(400).json({ status: "error", message: "Country code and mobile are required", data: null });

      }

      await user.update(profileUpdates);

    }



    const prefUpdates = {};

    if (avatar_url !== undefined) prefUpdates.avatar_url = avatar_url === null ? null : String(avatar_url).trim() || null;

    if (two_factor_enabled !== undefined) prefUpdates.two_factor_enabled = Boolean(two_factor_enabled);

    if (email_notifications !== undefined) prefUpdates.email_notifications = Boolean(email_notifications);

    if (case_updates !== undefined) prefUpdates.case_updates = Boolean(case_updates);

    if (payment_alerts !== undefined) prefUpdates.payment_alerts = Boolean(payment_alerts);

    if (timezone !== undefined) prefUpdates.timezone = String(timezone);

    if (language !== undefined) prefUpdates.language = String(language);

    if (date_format !== undefined) prefUpdates.date_format = String(date_format);

    if (data_collection !== undefined) prefUpdates.data_collection = Boolean(data_collection);



    if (Object.keys(prefUpdates).length > 0) {

      await prefs.update(prefUpdates);

    }



    await user.reload({ include: [{ model: Role, attributes: ["id", "name"] }] });

    await prefs.reload();



    const plain = user.toJSON();

    res.status(200).json({

      status: "success",

      message: "Settings updated.",

      data: {

        profile: {

          first_name: plain.first_name,

          last_name: plain.last_name,

          email: plain.email,

          country_code: plain.country_code,

          mobile: plain.mobile,

          phone: buildPhoneDisplay(plain.country_code, plain.mobile),

          avatar_url: prefs.avatar_url || null,

          role_id: plain.role_id,

          role_name: plain.Role?.name || null,

        },

        preferences: {

          two_factor_enabled: prefs.two_factor_enabled,

          email_notifications: prefs.email_notifications,

          case_updates: prefs.case_updates,

          payment_alerts: prefs.payment_alerts,

          timezone: prefs.timezone,

          language: prefs.language,

          date_format: prefs.date_format,

          data_collection: prefs.data_collection,

        },

      },

    });

  } catch (error) {

    console.error("patchMe settings error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



/** POST /change-password */

export const changePassword = async (req, res) => {

  try {

    const user = await requireAdmin(req, res);

    if (!user) return;



    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {

      return res.status(400).json({

        status: "error",

        message: "current_password and new_password are required",

        data: null,

      });

    }

    if (new_password.length < 8) {

      return res.status(400).json({

        status: "error",

        message: "New password must be at least 8 characters",

        data: null,

      });

    }



    const full = await User.findByPk(user.id);

    const ok = await bcrypt.compare(current_password, full.password);

    if (!ok) {

      return res.status(400).json({ status: "error", message: "Current password is incorrect", data: null });

    }



    const hashed = await bcrypt.hash(new_password, 12);

    await full.update({ password: hashed });



    res.status(200).json({ status: "success", message: "Password updated successfully.", data: null });

  } catch (error) {

    console.error("changePassword error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



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



/** Case categories */

export const listCaseCategories = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const rows = await CaseCategory.findAll({ order: [["name", "ASC"]] });

    res.status(200).json({

      status: "success",

      message: "Case categories retrieved.",

      data: { categories: rows.map((r) => ({ id: r.id, name: r.name })) },

    });

  } catch (error) {

    console.error("listCaseCategories error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



export const createCaseCategory = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const name = String(req.body?.name || "").trim();

    if (!name) {

      return res.status(400).json({ status: "error", message: "Name is required", data: null });

    }

    const existing = await CaseCategory.findOne({

      where: db.sequelize.where(

        db.sequelize.fn("LOWER", db.sequelize.fn("TRIM", db.sequelize.col("name"))),

        name.toLowerCase()

      ),

    });

    if (existing) {

      return res.status(400).json({ status: "error", message: "This category already exists", data: null });

    }

    const row = await CaseCategory.create({ name });

    res.status(201).json({

      status: "success",

      message: "Category created.",

      data: { category: { id: row.id, name: row.name } },

    });

  } catch (error) {

    console.error("createCaseCategory error:", error);

    if (error.name === "SequelizeUniqueConstraintError") {

      return res.status(400).json({ status: "error", message: "This category already exists", data: null });

    }

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



export const deleteCaseCategory = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) {

      return res.status(400).json({ status: "error", message: "Invalid id", data: null });

    }

    const row = await CaseCategory.findByPk(id);

    if (!row) {

      return res.status(404).json({ status: "error", message: "Category not found", data: null });

    }

    await row.destroy();

    res.status(200).json({ status: "success", message: "Category deleted.", data: null });

  } catch (error) {

    console.error("deleteCaseCategory error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



/** Email templates */

export const listEmailTemplates = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const rows = await EmailTemplateSetting.findAll({ order: [["template_key", "ASC"]] });

    res.status(200).json({

      status: "success",

      message: "Email templates retrieved.",

      data: {

        templates: rows.map((r) => ({

          key: r.template_key,

          subject: r.subject,

          body: r.body,

        })),

      },

    });

  } catch (error) {

    console.error("listEmailTemplates error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



export const getEmailTemplateByKey = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const key = String(req.params.key || "").trim();

    if (!EMAIL_TEMPLATE_KEYS.includes(key)) {

      return res.status(400).json({ status: "error", message: "Invalid template key", data: null });

    }

    const row = await EmailTemplateSetting.findOne({ where: { template_key: key } });

    if (!row) {

      return res.status(404).json({ status: "error", message: "Template not found", data: null });

    }

    res.status(200).json({

      status: "success",

      message: "Email template retrieved.",

      data: { template: { key: row.template_key, subject: row.subject, body: row.body } },

    });

  } catch (error) {

    console.error("getEmailTemplateByKey error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



export const updateEmailTemplate = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const key = String(req.params.key || "").trim();

    if (!EMAIL_TEMPLATE_KEYS.includes(key)) {

      return res.status(400).json({ status: "error", message: "Invalid template key", data: null });

    }

    const { subject, body } = req.body;

    if (subject === undefined && body === undefined) {

      return res.status(400).json({ status: "error", message: "subject or body is required", data: null });

    }

    const row = await EmailTemplateSetting.findOne({ where: { template_key: key } });

    if (!row) {

      return res.status(404).json({ status: "error", message: "Template not found", data: null });

    }

    const updates = {};

    if (subject !== undefined) updates.subject = String(subject);

    if (body !== undefined) updates.body = String(body);

    await row.update(updates);

    res.status(200).json({

      status: "success",

      message: "Email template updated.",

      data: { template: { key: row.template_key, subject: row.subject, body: row.body } },

    });

  } catch (error) {

    console.error("updateEmailTemplate error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



/** SLA */

async function getSlaRow() {

  let row = await SlaSetting.findByPk(1);

  if (!row) {

    row = await SlaSetting.findOne({ order: [["id", "ASC"]] });

  }

  if (!row) {

    row = await SlaSetting.create({

      skilled_worker_days: 45,

      ilr_days: 30,

      student_visa_days: 60,

      escalation_stuck_days: 3,

      missing_docs_escalation_days: 7,

    });

  }

  return row;

}



export const getSla = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const row = await getSlaRow();

    res.status(200).json({

      status: "success",

      message: "SLA settings retrieved.",

      data: {

        sla: {

          skilled_worker_days: row.skilled_worker_days,

          ilr_days: row.ilr_days,

          student_visa_days: row.student_visa_days,

          escalation_stuck_days: row.escalation_stuck_days,

          missing_docs_escalation_days: row.missing_docs_escalation_days,

        },

      },

    });

  } catch (error) {

    console.error("getSla error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};



export const updateSla = async (req, res) => {

  try {

    if (!(await requireAdmin(req, res))) return;

    const row = await getSlaRow();

    const {

      skilled_worker_days,

      ilr_days,

      student_visa_days,

      escalation_stuck_days,

      missing_docs_escalation_days,

    } = req.body;



    const updates = {};

    const nums = [

      ["skilled_worker_days", skilled_worker_days],

      ["ilr_days", ilr_days],

      ["student_visa_days", student_visa_days],

      ["escalation_stuck_days", escalation_stuck_days],

      ["missing_docs_escalation_days", missing_docs_escalation_days],

    ];

    for (const [field, val] of nums) {

      if (val !== undefined) {

        const n = parseInt(String(val), 10);

        if (Number.isNaN(n) || n < 0) {

          return res.status(400).json({ status: "error", message: `${field} must be a non-negative integer`, data: null });

        }

        updates[field] = n;

      }

    }

    if (Object.keys(updates).length === 0) {

      return res.status(400).json({ status: "error", message: "No valid fields to update", data: null });

    }

    await row.update(updates);

    res.status(200).json({

      status: "success",

      message: "SLA settings updated.",

      data: {

        sla: {

          skilled_worker_days: row.skilled_worker_days,

          ilr_days: row.ilr_days,

          student_visa_days: row.student_visa_days,

          escalation_stuck_days: row.escalation_stuck_days,

          missing_docs_escalation_days: row.missing_docs_escalation_days,

        },

      },

    });

  } catch (error) {

    console.error("updateSla error:", error);

    res.status(500).json({ status: "error", message: "Internal server error", data: null, error: error.message });

  }

};

