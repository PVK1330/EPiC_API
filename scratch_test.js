import 'dotenv/config';
import db from './src/models/index.js';
import { getTenantDb } from './src/services/tenantDb.service.js';
import { ensureStageTasks } from './src/services/licenceStageTask.service.js';

async function run() {
  try {
    const org = await db.Organisation.findOne({ where: { slug: 'testing12' } });
    if (!org) {
      console.log("Organisation testing12 not found.");
      process.exit(0);
    }
    
    const tenantDb = getTenantDb(org.database_name);
    
    // Call ensureStageTasks
    console.log("Calling ensureStageTasks...");
    await ensureStageTasks(tenantDb, 1);
    console.log("Called successfully.");

    // Query tasks
    const tasks = await tenantDb.LicenceStageTask.findAll({
      where: { licenceApplicationId: 1 },
      order: [['stageOrder', 'ASC'], ['id', 'ASC']]
    });
    
    console.log("Tasks in tenant DB after calling ensureStageTasks:");
    tasks.forEach(t => {
      console.log(`- Stage: ${t.stageKey} (${t.stageOrder}), Role: ${t.role}, Status: ${t.status}, AssignedTo: ${t.assigneeName} (${t.assignedToUserId})`);
    });
    
  } catch (err) {
    console.error("Error during test run:", err);
  }
  process.exit(0);
}

run();
