import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

/**
 * Ensures a default tenant exists in the platform registry.
 */
export default async function seedOrganisations() {
  try {
    const enterprisePlan = await platformDb.Plan.findOne({ where: { name: "Enterprise" } });
    
    const [org] = await platformDb.Organisation.findOrCreate({
      where: { slug: "epic-default" },
      defaults: {
        name: "EPiC Default",
        slug: "epic-default",
        plan_id: enterprisePlan?.id || null,
        status: "active",
        primaryEmail: "platform@epic.local",
        country: null,
        database_name: null,
      },
    });
    logger.info(`✔ Organisation ready: ${org.slug} (id=${org.id})`);

    // Ensure plan_id is set if it was previously null (from old schema)
    if (!org.plan_id && enterprisePlan) {
      await org.update({ plan_id: enterprisePlan.id });
      logger.info(`✔ Updated organisation ${org.slug} with plan_id ${enterprisePlan.id}`);
    }
  } catch (err) {
    logger.error({ err }, "Organisation seeder failed");
    throw err;
  }
}
