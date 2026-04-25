import 'dotenv/config';
import db from "./src/models/index.js";

(async () => {
  try {
    const admin = await db.User.findOne({ where: { email: 'admin@admin.com' } });
    
    await db.AuditLog.bulkCreate([
      {
        user_id: admin ? admin.id : null,
        action: 'Login',
        resource: 'System',
        ip_address: '192.168.1.100',
        status: 'Success',
        details: 'User logged in successfully'
      },
      {
        user_id: admin ? admin.id : null,
        action: 'Case Created',
        resource: 'Case #CAS-045',
        ip_address: '192.168.1.100',
        status: 'Success',
        details: 'H-1B visa case created for Tech Solutions Ltd'
      },
      {
        user_id: null,
        action: 'Login',
        resource: 'System',
        ip_address: '192.168.1.108',
        status: 'Failed',
        details: 'Invalid password - 3rd attempt'
      }
    ]);
    console.log("Mock data added");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
