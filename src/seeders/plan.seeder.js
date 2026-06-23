
import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

const plans = [
  {
    name: "Starter",
  description: "Perfect for small agencies",
    price: 49.00,
    currency: "GBP",
    billing_cycle: "monthly",
    user_quota: 5,
    case_quota: 20,
    storage_quota_gb: 2,
    features: ["Case Management", "Document Storage", "Email Notifications"],
    is_public: true,
    status: "active"
  },
  {
    name: "Professional",
    description: "For growing businesses",
    price: 99.00,
    currency: "GBP",
    billing_cycle: "monthly",
    user_quota: 15,
    case_quota: 100,
    storage_quota_gb: 10,
    features: ["Everything in Starter", "Advanced Reporting", "Custom Workflows", "API Access"],
    is_public: true,
    status: "active"
  },
  {
    name: "Enterprise",
    description: "Full power for large organisations",
    price: 249.00,
    currency: "GBP",
    billing_cycle: "monthly",
    user_quota: 50,
    case_quota: 500,
    storage_quota_gb: 50,
    features: ["Everything in Professional", "Dedicated Support", "SSO Integration", "Custom Domain"],
    is_public: true,
    status: "active"
  }
];

export const seedPlans = async () => {
  try {
    for (const plan of plans) {
      await platformDb.Plan.findOrCreate({
        where: { name: plan.name },
        defaults: plan
      });
    }
    logger.info("Plans seeded successfully");
  } catch (error) {
    logger.error({ err: error }, "Error seeding plans");
  }
};
