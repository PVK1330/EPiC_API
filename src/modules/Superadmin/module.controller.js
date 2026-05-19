import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

export const getAllModules = catchAsync(async (req, res) => {
  const modules = await platformDb.Module.findAll({
    where: { is_active: true },
    order: [
      ["panel", "ASC"],
      ["sort_order", "ASC"],
    ],
  });

  const grouped = modules.reduce((acc, mod) => {
    if (!acc[mod.panel]) acc[mod.panel] = [];
    acc[mod.panel].push(mod);
    return acc;
  }, {});

  return ApiResponse.success(res, "Modules retrieved successfully", { modules: grouped });
});

export const createModule = catchAsync(async (req, res) => {
  const { key, label, panel, icon, sort_order } = req.body;

  if (!key || !label || !panel) {
    return ApiResponse.badRequest(res, "key, label, and panel are required");
  }

  const existing = await platformDb.Module.findOne({ where: { key } });
  if (existing) {
    return ApiResponse.badRequest(res, "Module key already exists");
  }

  const mod = await platformDb.Module.create({ key, label, panel, icon, sort_order: sort_order || 0 });

  return ApiResponse.created(res, "Module created successfully", { module: mod });
});

export const updateModule = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { label, icon, sort_order } = req.body;

  const mod = await platformDb.Module.findByPk(id);
  if (!mod) {
    return ApiResponse.notFound(res, "Module not found");
  }

  await mod.update({ label, icon, sort_order });

  return ApiResponse.success(res, "Module updated successfully", { module: mod });
});

export const deleteModule = catchAsync(async (req, res) => {
  const { id } = req.params;

  const mod = await platformDb.Module.findByPk(id);
  if (!mod) {
    return ApiResponse.notFound(res, "Module not found");
  }

  await mod.update({ is_active: false });

  return ApiResponse.success(res, "Module deactivated successfully");
});

export const getModulesByPlan = catchAsync(async (req, res) => {
  const { planId } = req.params;

  const plan = await platformDb.Plan.findByPk(planId, {
    include: [
      {
        model: platformDb.Module,
        as: "modules",
        through: { attributes: [] },
        where: { is_active: true },
        required: false,
      },
    ],
  });

  if (!plan) {
    return ApiResponse.notFound(res, "Plan not found");
  }

  return ApiResponse.success(res, "Plan modules retrieved successfully", {
    plan_id: plan.id,
    modules: plan.modules,
  });
});

export const updatePlanModules = catchAsync(async (req, res) => {
  const { planId } = req.params;
  const { module_ids } = req.body;

  if (!Array.isArray(module_ids)) {
    return ApiResponse.badRequest(res, "module_ids must be an array");
  }

  const plan = await platformDb.Plan.findByPk(planId);
  if (!plan) {
    return ApiResponse.notFound(res, "Plan not found");
  }

  const transaction = await platformDb.sequelize.transaction();

  try {
    await platformDb.PlanModule.destroy({ where: { plan_id: planId }, transaction });

    if (module_ids.length > 0) {
      const rows = module_ids.map((module_id) => ({ plan_id: parseInt(planId, 10), module_id }));
      await platformDb.PlanModule.bulkCreate(rows, { transaction, ignoreDuplicates: true });
    }

    await transaction.commit();

    return ApiResponse.success(res, "Plan modules updated successfully");
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
});
