import 'dotenv/config';
import pg from 'pg';

async function check() {
  const dbModule = await import('./src/models/index.js');
  const db = dbModule.default;
  const tenantDb = await import('./src/services/tenantDb.service.js');
  const NotificationService = await import('./src/services/notification.service.js');
  
  const org = await db.Organisation.findOne();
  if (!org) return;
  
  console.log("Connecting to tenant DB:", org.database_name);
  const tdb = tenantDb.getTenantDb(org.database_name);
  
  try {
    const count = await NotificationService.getUnreadCount(tdb, 1);
    console.log("Unread count:", count);
    
    const res = await NotificationService.getUserNotifications(tdb, 1, { limit: 2 });
    console.log("Notifications fetched:", res.notifications.length);
  } catch (err) {
    console.error("Test failed:", err);
  }
  process.exit(0);
}

check().catch(console.error);
