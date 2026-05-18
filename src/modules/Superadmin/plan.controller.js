import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

/**
 * Get all subscription plans
 */
export const getAllPlans = catchAsync(async (req, res) => {
  const plans = await platformDb.Plan.findAll({
    order: [["price", "ASC"]],
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
  return ApiResponse.success(res, "Plans retrieved successfully", { plans });
});

export const getPlanById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const plan = await platformDb.Plan.findByPk(id, {
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
  return ApiResponse.success(res, "Plan retrieved successfully", { plan });
});

/**
 * Create a new subscription plan
 */
export const createPlan = catchAsync(async (req, res) => {
  const {
    name,
    description,
    price,
    currency,
    billing_cycle,
    user_quota,
    case_quota,
    storage_quota_gb,
    features,
    is_public,
  } = req.body;

  if (!name || price === undefined) {
    return ApiResponse.badRequest(res, "Name and price are required");
  }

  // Check if name already exists
  const existingPlan = await platformDb.Plan.findOne({ where: { name } });
  if (existingPlan) {
    return ApiResponse.badRequest(res, "Plan name already exists");
  }

  const plan = await platformDb.Plan.create({
    name,
    description,
    price,
    currency,
    billing_cycle,
    user_quota,
    case_quota,
    storage_quota_gb,
    features,
    is_public,
  });

  return ApiResponse.created(res, "Plan created successfully", { plan });
});

/**
 * Update an existing plan
 */
export const updatePlan = catchAsync(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    price,
    currency,
    billing_cycle,
    user_quota,
    case_quota,
    storage_quota_gb,
    features,
    is_public,
    status,
  } = req.body;

  const plan = await platformDb.Plan.findByPk(id);
  if (!plan) {
    return ApiResponse.notFound(res, "Plan not found");
  }

  if (name && name !== plan.name) {
    const existingName = await platformDb.Plan.findOne({ where: { name } });
    if (existingName) {
      return ApiResponse.badRequest(res, "Plan name already exists");
    }
  }

  await plan.update({
    name,
    description,
    price,
    currency,
    billing_cycle,
    user_quota,
    case_quota,
    storage_quota_gb,
    features,
    is_public,
    status,
  });

  return ApiResponse.success(res, "Plan updated successfully", { plan });
});

/**
 * Delete (archive) a plan
 */
export const deletePlan = catchAsync(async (req, res) => {
  const { id } = req.params;
  const plan = await platformDb.Plan.findByPk(id);
  if (!plan) {
    return ApiResponse.notFound(res, "Plan not found");
  }

  // Check if any organisation is using this plan
  const usageCount = await platformDb.Organisation.count({ where: { plan_id: id } });
  if (usageCount > 0) {
    // If used, just deactivate it
    await plan.update({ status: 'archived', is_public: false });
    return ApiResponse.success(res, "Plan is in use. It has been archived and hidden instead of deleted.");
  }

  await plan.destroy();
  return ApiResponse.success(res, "Plan deleted successfully");
});
