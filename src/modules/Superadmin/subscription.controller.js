import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

export const getAllSubscriptions = catchAsync(async (req, res) => {
  const subscriptions = await platformDb.Subscription.findAll({
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail"],
      },
      {
        model: platformDb.Plan,
        as: "plan",
        attributes: ["id", "name", "price", "billing_cycle"],
      },
    ],
    order: [["createdAt", "DESC"]],
  });
  return ApiResponse.success(res, "Subscriptions retrieved successfully", { subscriptions });
});

export const getSubscriptionByOrg = catchAsync(async (req, res) => {
  const { orgId } = req.params;
  const subscription = await platformDb.Subscription.findOne({
    where: { organisation_id: orgId },
    include: [
      {
        model: platformDb.Organisation,
        as: "organisation",
        attributes: ["id", "name", "slug", "primaryEmail"],
      },
      {
        model: platformDb.Plan,
        as: "plan",
        attributes: ["id", "name", "price", "billing_cycle"],
      },
    ],
  });
  if (!subscription) {
    return ApiResponse.notFound(res, "Subscription not found");
  }
  return ApiResponse.success(res, "Subscription retrieved successfully", { subscription });
});

export const createSubscription = catchAsync(async (req, res) => {
  const { organisation_id, plan_id, status, current_period_start, current_period_end, trial_ends_at } = req.body;

  if (!organisation_id || !plan_id) {
    return ApiResponse.badRequest(res, "organisation_id and plan_id are required");
  }

  const subscription = await platformDb.Subscription.create({
    organisation_id,
    plan_id,
    status: status || 'trial',
    current_period_start,
    current_period_end,
    trial_ends_at,
  });

  return ApiResponse.created(res, "Subscription created successfully", { subscription });
});

export const updateSubscription = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status, current_period_start, current_period_end, trial_ends_at, cancelled_at } = req.body;

  const subscription = await platformDb.Subscription.findByPk(id);
  if (!subscription) {
    return ApiResponse.notFound(res, "Subscription not found");
  }

  await subscription.update({
    status,
    current_period_start,
    current_period_end,
    trial_ends_at,
    cancelled_at,
  });

  return ApiResponse.success(res, "Subscription updated successfully", { subscription });
});

export const cancelSubscription = catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await platformDb.Subscription.findByPk(id);
  if (!subscription) {
    return ApiResponse.notFound(res, "Subscription not found");
  }

  await subscription.update({
    status: 'cancelled',
    cancelled_at: new Date(),
  });

  return ApiResponse.success(res, "Subscription cancelled successfully", { subscription });
});

export const renewSubscription = catchAsync(async (req, res) => {
  const { id } = req.params;

  const transaction = await platformDb.sequelize.transaction();

  try {
    const subscription = await platformDb.Subscription.findByPk(id, {
      include: [{ model: platformDb.Plan, as: "plan" }],
      transaction,
    });

    if (!subscription) {
      await transaction.rollback();
      return ApiResponse.notFound(res, "Subscription not found");
    }

    const plan = subscription.plan;
    const now = new Date();
    let newPeriodEnd = new Date(subscription.current_period_end || now);

    if (plan.billing_cycle === 'monthly') {
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    } else if (plan.billing_cycle === 'yearly') {
      newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
    }

    await subscription.update({
      status: 'active',
      current_period_start: subscription.current_period_end || now,
      current_period_end: newPeriodEnd,
    }, { transaction });

    const invoiceNumber = `INV-${Date.now()}-${subscription.organisation_id}`;
    const dueDate = new Date(newPeriodEnd);
    dueDate.setDate(dueDate.getDate() - 7);

    await platformDb.Invoice.create({
      organisation_id: subscription.organisation_id,
      subscription_id: subscription.id,
      invoice_number: invoiceNumber,
      amount: plan.price,
      currency: plan.currency || 'GBP',
      status: 'pending',
      due_at: dueDate,
    }, { transaction });

    await transaction.commit();

    return ApiResponse.success(res, "Subscription renewed successfully", { subscription });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});
