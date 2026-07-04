import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

export default async function seedPlatformNotifications() {
  try {
    const existing = await platformDb.PlatformNotification.count();
    if (existing > 0) {
      logger.info("✔ Platform notifications already seeded.");
      return;
    }

    const notifications = [
      { title: "New Organisation Signed Up", message: "Elite Visa Solutions completed their signup. They are awaiting caseworker allocations and final license approval reviews.", type: "success", isRead: false },
      { title: "Server CPU Load Alert", message: "Database CPU utilization exceeded 85% for more than 5 minutes. Autoscale group monitored.", type: "warning", isRead: false },
      { title: "Stripe Payment Failed", message: "Automatic renewal charge failed for Westminster Agency (INV-2026-05-8912). Automatic retry scheduled in 24 hours.", type: "error", isRead: false },
      { title: "Upcoming Maintenance window", message: "Scheduled platform updates to v2.5.2 are scheduled for Saturday 02:00 AM UTC. Estimated downtime is less than 15 minutes.", type: "info", isRead: true },
      { title: "Platform S3 Backup Complete", message: "Daily central backup finished successfully. 14.8 GB archived.", type: "success", isRead: true },
      { title: "Trial Period Expired", message: "Bridge UK Immigration's free trial period has ended. Send subscription upgrade notification email.", type: "warning", isRead: true }
    ];

    await platformDb.PlatformNotification.bulkCreate(notifications);
    logger.info("✔ Platform notifications seeded successfully.");
  } catch (err) {
    logger.error({ err }, "Platform notification seeder failed");
  }
}
