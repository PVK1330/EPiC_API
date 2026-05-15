import 'dotenv/config';
import app from './app.js';
import db from './models/index.js';
import seedRoles from './seeders/role.seeder.js';
import seedOrganisations from './seeders/organisation.seeder.js';
import seedAdmin from './seeders/admin.seeder.js';
import seedPermissions from './seeders/permission.seeder.js';
import { initializeFieldSettings } from './controllers/AdminControllers/applicationFields.controller.js';
import http from 'http';
import { initSocketIO } from './realtime/socketServer.js';

const PORT = process.env.PORT || 5000;

db.sequelize.sync().then(async () => {
  try {
    await db.Case.sync({ alter: true });
    console.log('Case table schema synchronized successfully');
  } catch (syncErr) {
    console.error('Individual Case sync note:', syncErr.message);
  }

  await db.sequelize.query(
    'ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "database_name" VARCHAR(63);'
  );

  console.log('Database connected');
  await seedRoles();
  await seedOrganisations();
  await seedAdmin();
  await seedPermissions();
  await initializeFieldSettings();

  const server = http.createServer(app);
  initSocketIO(server, app);

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to database:', err);
  process.exit(1);
});
