import platformDb from "../src/models/index.js";

async function backfill() {
  try {
    const orgs = await platformDb.Organisation.findAll();
    console.log(`Found ${orgs.length} organisations. Checking subscriptions...`);
    
    for (const org of orgs) {
      const sub = await platformDb.Subscription.findOne({ where: { organisation_id: org.id } });
      if (!sub) {
        const now = new Date();
        const trialEndsAt = new Date(now);
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);

        await platformDb.Subscription.create({
          organisation_id: org.id,
          plan_id: org.plan_id || null,
          status: org.status || "trial",
          current_period_start: now,
          current_period_end: trialEndsAt,
          trial_ends_at: trialEndsAt,
        });
        console.log(`Created missing subscription for ${org.name} (ID: ${org.id})`);
      } else {
        console.log(`Subscription already exists for ${org.name}`);
      }
    }
    console.log("Backfill complete.");
    process.exit(0);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  }
}

backfill();
