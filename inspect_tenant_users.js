import 'dotenv/config';
import db from './src/models/index.js';
import { getTenantDb } from './src/services/tenantDb.service.js';

async function run() {
  try {
    const org = await db.Organisation.findOne({ where: { slug: 'testing12' } });
    if (!org) {
      console.error("Organisation testing12 not found.");
      process.exit(1);
    }
    
    const tenantDb = getTenantDb(org.database_name);
    
    const users = await tenantDb.User.findAll({
      attributes: ['id', 'first_name', 'last_name', 'email', 'role_id']
    });
    
    console.log("Users in Tenant DB:");
    users.forEach(u => {
      console.log(`- ID: ${u.id}, Name: ${u.first_name} ${u.last_name}, Email: ${u.email}, Role: ${u.role_id}`);
    });
    
    console.log("\nUsers in Platform DB:");
    const platformUsers = await db.User.findAll({
      attributes: ['id', 'first_name', 'last_name', 'email', 'role_id']
    });
    platformUsers.forEach(u => {
      console.log(`- ID: ${u.id}, Name: ${u.first_name} ${u.last_name}, Email: ${u.email}, Role: ${u.role_id}`);
    });
    
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
