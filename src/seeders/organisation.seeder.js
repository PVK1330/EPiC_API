import platformDb from "../models/index.js";

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
    console.log(`✔ Organisation ready: ${org.slug} (id=${org.id})`);

    // Ensure plan_id is set if it was previously null (from old schema)
    if (!org.plan_id && enterprisePlan) {
      await org.update({ plan_id: enterprisePlan.id });
      console.log(`✔ Updated organisation ${org.slug} with plan_id ${enterprisePlan.id}`);
    }
  } catch (err) {
    console.error("Organisation seeder failed:", err.message);
    throw err;
  }
}
