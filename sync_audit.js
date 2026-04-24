import 'dotenv/config';
import db from "./src/models/index.js";
(async () => {
  try {
    await db.AuditLog.sync({ alter: true });
    console.log("Audit logs table synced successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Sync error:", err);
    process.exit(1);
  }
})();
