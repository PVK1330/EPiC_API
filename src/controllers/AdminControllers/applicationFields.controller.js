import db from "../../models/index.js";
import crypto from "crypto";
import seedApplicationFieldSettings from "../../seeders/applicationFieldSettings.seeder.js";

const ApplicationFieldSetting = db.ApplicationFieldSetting;
const ApplicationCustomField = db.ApplicationCustomField;

export const initializeFieldSettings = async () => {
  await seedApplicationFieldSettings();
};

// Get all field settings
export const getFieldSettings = async (req, res) => {
  try {
    const settings = await ApplicationFieldSetting.findAll({
      order: [['field_order', 'ASC']]
    });

    // Parse options from JSON string if needed
    const parsedSettings = settings.map(setting => ({
      ...setting.toJSON(),
      options: setting.options ? (typeof setting.options === 'string' ? JSON.parse(setting.options) : setting.options) : null,
      validation_rules: setting.validation_rules ? (typeof setting.validation_rules === 'string' ? JSON.parse(setting.validation_rules) : setting.validation_rules) : null
    }));

    res.status(200).json({
      status: "success",
      message: "Field settings retrieved successfully",
      data: parsedSettings
    });
  } catch (error) {
    console.error("Get Field Settings Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Batch update field visibility
export const batchUpdateFieldVisibility = async (req, res) => {
  try {
    const { visibility } = req.body;

    if (!visibility || typeof visibility !== 'object') {
      return res.status(400).json({
        status: "error",
        message: "Visibility object is required",
        data: null
      });
    }

    // Update each field's visibility
    const updates = Object.entries(visibility).map(([field_key, is_visible]) => {
      return ApplicationFieldSetting.update(
        { is_visible },
        { where: { field_key } }
      );
    });

    await Promise.all(updates);

    res.status(200).json({
      status: "success",
      message: "Field visibility updated successfully",
      data: null
    });
  } catch (error) {
    console.error("Batch Update Field Visibility Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

export const updateFieldVisibilityById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_visible } = req.body;
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid id",
        data: null,
      });
    }
    if (typeof is_visible !== "boolean") {
      return res.status(400).json({
        status: "error",
        message: "is_visible must be a boolean",
        data: null,
      });
    }
    const setting = await ApplicationFieldSetting.findByPk(id);
    if (!setting) {
      return res.status(404).json({
        status: "error",
        message: "Field setting not found",
        data: null,
      });
    }
    await setting.update({ is_visible });
    const raw = setting.toJSON();
    let optionsParsed = null;
    let validationParsed = null;
    try {
      optionsParsed = raw.options
        ? typeof raw.options === "string"
          ? JSON.parse(raw.options)
          : raw.options
        : null;
    } catch {
      optionsParsed = null;
    }
    try {
      validationParsed = raw.validation_rules
        ? typeof raw.validation_rules === "string"
          ? JSON.parse(raw.validation_rules)
          : raw.validation_rules
        : null;
    } catch {
      validationParsed = null;
    }
    const parsed = {
      ...raw,
      options: optionsParsed,
      validation_rules: validationParsed,
    };
    res.status(200).json({
      status: "success",
      message: "Field visibility updated successfully",
      data: parsed,
    });
  } catch (error) {
    console.error("Update Field Visibility By Id Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

export const updateSingleFieldVisibility = async (req, res) => {
  try {
    const { field_key } = req.params;
    const { is_visible } = req.body;

    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({
        status: "error",
        message: "is_visible must be a boolean",
        data: null
      });
    }

    const setting = await ApplicationFieldSetting.findOne({ where: { field_key } });

    if (!setting) {
      return res.status(404).json({
        status: "error",
        message: "Field setting not found",
        data: null
      });
    }

    await setting.update({ is_visible });

    res.status(200).json({
      status: "success",
      message: "Field visibility updated successfully",
      data: setting
    });
  } catch (error) {
    console.error("Update Single Field Visibility Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get all custom fields
export const getCustomFields = async (req, res) => {
  try {
    const customFields = await ApplicationCustomField.findAll({
      where: { is_active: true },
      order: [['display_order', 'ASC']]
    });

    // Parse options from JSON string if needed
    const parsedFields = customFields.map(field => ({
      ...field.toJSON(),
      options: field.options ? (typeof field.options === 'string' ? JSON.parse(field.options) : field.options) : null,
      validation_rules: field.validation_rules ? (typeof field.validation_rules === 'string' ? JSON.parse(field.validation_rules) : field.validation_rules) : null
    }));

    res.status(200).json({
      status: "success",
      message: "Custom fields retrieved successfully",
      data: parsedFields
    });
  } catch (error) {
    console.error("Get Custom Fields Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Create custom field
export const createCustomField = async (req, res) => {
  try {
    let { field_id, label, field_type, placeholder, is_required, options, validation_rules, description, display_order } = req.body;

    if (!label || !field_type) {
      return res.status(400).json({
        status: "error",
        message: "label and field_type are required",
        data: null
      });
    }

    if (!field_id) {
      field_id = crypto.randomUUID();
    }

    // Check if field_id already exists
    const existingField = await ApplicationCustomField.findOne({ where: { field_id } });
    if (existingField) {
      return res.status(400).json({
        status: "error",
        message: "Custom field with this field_id already exists",
        data: null
      });
    }

    const customField = await ApplicationCustomField.create({
      field_id,
      label,
      field_type,
      placeholder,
      is_required: is_required || false,
      options: options ? JSON.stringify(options) : null,
      validation_rules: validation_rules ? JSON.stringify(validation_rules) : null,
      description,
      display_order: display_order || 0
    });

    res.status(201).json({
      status: "success",
      message: "Custom field created successfully",
      data: customField
    });
  } catch (error) {
    console.error("Create Custom Field Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Update custom field
export const updateCustomField = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, field_type, placeholder, is_required, options, validation_rules, description, display_order, is_active } = req.body;

    const customField = await ApplicationCustomField.findByPk(id);

    if (!customField) {
      return res.status(404).json({
        status: "error",
        message: "Custom field not found",
        data: null
      });
    }

    const updateData = {
      label: label || customField.label,
      field_type: field_type || customField.field_type,
      placeholder: placeholder !== undefined ? placeholder : customField.placeholder,
      is_required: is_required !== undefined ? is_required : customField.is_required,
      options: options !== undefined ? (options ? JSON.stringify(options) : null) : customField.options,
      validation_rules: validation_rules !== undefined ? (validation_rules ? JSON.stringify(validation_rules) : null) : customField.validation_rules,
      description: description !== undefined ? description : customField.description,
      display_order: display_order !== undefined ? display_order : customField.display_order,
      is_active: is_active !== undefined ? is_active : customField.is_active
    };

    await customField.update(updateData);

    res.status(200).json({
      status: "success",
      message: "Custom field updated successfully",
      data: customField
    });
  } catch (error) {
    console.error("Update Custom Field Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Delete custom field
export const deleteCustomField = async (req, res) => {
  try {
    const { id } = req.params;

    const customField = await ApplicationCustomField.findByPk(id);

    if (!customField) {
      return res.status(404).json({
        status: "error",
        message: "Custom field not found",
        data: null
      });
    }

    await customField.destroy();

    res.status(200).json({
      status: "success",
      message: "Custom field deleted successfully",
      data: null
    });
  } catch (error) {
    console.error("Delete Custom Field Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Update field setting (general update)
export const updateFieldSetting = async (req, res) => {
  try {
    const { field_key } = req.params;
    const { field_label, is_visible, is_required, field_order, field_type, options, validation_rules, description } = req.body;

    const setting = await ApplicationFieldSetting.findOne({ where: { field_key } });

    if (!setting) {
      return res.status(404).json({
        status: "error",
        message: "Field setting not found",
        data: null
      });
    }

    const updateData = {
      field_label: field_label || setting.field_label,
      is_visible: is_visible !== undefined ? is_visible : setting.is_visible,
      is_required: is_required !== undefined ? is_required : setting.is_required,
      field_order: field_order !== undefined ? field_order : setting.field_order,
      field_type: field_type || setting.field_type,
      options: options !== undefined ? (options ? JSON.stringify(options) : null) : setting.options,
      validation_rules: validation_rules !== undefined ? (validation_rules ? JSON.stringify(validation_rules) : null) : setting.validation_rules,
      description: description !== undefined ? description : setting.description
    };

    await setting.update(updateData);

    res.status(200).json({
      status: "success",
      message: "Field setting updated successfully",
      data: setting
    });
  } catch (error) {
    console.error("Update Field Setting Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};
