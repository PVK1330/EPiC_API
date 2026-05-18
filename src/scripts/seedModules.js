import 'dotenv/config';
import platformDb from '../models/index.js';
import { seedModules } from '../seeders/module.seeder.js';

async function run() {
  try {
    await platformDb.sequelize.authenticate();
    console.log('Database connected');

    await platformDb.Module.sync({ alter: false });
    await platformDb.PlanModule.sync({ alter: false });

    await seedModules();
    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

run();
