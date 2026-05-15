import db from "../models/index.js";

/**
 * Ensures a default tenant exists for single-DB multi-tenant mode.
 * Assign users to this org via admin.seeder or DEFAULT_ORGANISATION_ID.
 */
export default async function seedOrganisations() {
  try {
    const [org] = await db.Organisation.findOrCreate({
      where: { slug: "epic-default" },
      defaults: {
        name: "EPiC Default",
        slug: "epic-default",
        plan: "enterprise",
        status: "active",
        primaryEmail: "platform@epic.local",
        country: null,
      },
    });
    console.log(`✔ Organisation ready: ${org.slug} (id=${org.id})`);
  } catch (err) {
    console.error("Organisation seeder failed:", err.message);
  }
}
