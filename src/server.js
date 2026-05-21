import 'dotenv/config';
import app from './app.js';
import platformDb from './models/index.js';
import { seedPlans } from './seeders/plan.seeder.js';
import seedAdmin from './seeders/admin.seeder.js';
import { seedRolesForDb } from './seeders/role.seeder.js';
import { seedPermissionsForDb } from './seeders/permission.seeder.js';
import { seedModules } from './seeders/module.seeder.js';
import { seedPlatformRbacForDb } from './seeders/platformRbac.seeder.js';
import {
  createTenantPostgresDatabase,
  ensureTenantPostgresDatabase,
  resolveOrganisationDatabaseName,
  syncTenantDatabaseSchema,
} from './services/tenantDatabaseProvision.service.js';
import { runPlatformMigrations } from './migrations/run.js';
import { getTenantDb } from './services/tenantDb.service.js';
import { seedTenantDefaults, seedTenantOrganisation } from './services/tenantSeed.service.js';
import { checkAndExpireSubscriptions } from './services/subscriptionExpiry.service.js';
import http from 'http';
import { initSocketIO } from './realtime/socketServer.js';
import { normalizePostgresDatabaseName } from './utils/postgresDbName.js';
import { verifyMailTransport } from './services/mail.service.js';

const PORT = process.env.PORT || 5000;

async function ensureOrganisationTenantDatabase(org) {
  const databaseName = await resolveOrganisationDatabaseName(org);

  if (org.database_name !== databaseName) {
    await org.update({ database_name: databaseName });
  }

  const { created } = await ensureTenantPostgresDatabase(databaseName);
  if (created) {
    console.log(`✔ Created tenant database: ${databaseName}`);
  }

  await syncTenantDatabaseSchema(databaseName);

  const tenantDb = getTenantDb(databaseName);
  await seedTenantDefaults(tenantDb);
  await seedTenantOrganisation(tenantDb, org);
  return tenantDb;
}

async function bootstrapPlatform() {
  try {
    const centralDbName = normalizePostgresDatabaseName(
      process.env.DB_NAME,
      'epic_central',
    );
    console.log(`Ensuring Platform Database exists: ${centralDbName}...`);
    const dbResult = await createTenantPostgresDatabase(centralDbName);
    if (dbResult.created) {
      console.log(`✔ Created new platform database: ${centralDbName}`);
    } else {
      console.log(`✔ Platform database verified: ${centralDbName}`);
    }
    
    await platformDb.sequelize.authenticate();
    console.log('Platform database connected');
    
    await platformDb.sequelize.sync();
    console.log('✔ Platform schema synchronized');

    await runPlatformMigrations();
    console.log('✔ Platform SQL migrations applied');
    
    await seedRolesForDb(platformDb);
    await seedPermissionsForDb(platformDb);
    await seedPlatformRbacForDb(platformDb);

    await platformDb.sequelize.query(
      'ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "database_name" VARCHAR(63);',
    );
    await platformDb.sequelize.query(
      'ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "plan_id" INTEGER;',
    );
    await platformDb.sequelize.query(
      'ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "smtp_settings" JSONB DEFAULT NULL;',
    );
    await platformDb.sequelize.query(
      'ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;',
    );
    await platformDb.sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_organisations_deleted_at ON organisations (deleted_at);',
    );

    await seedPlans();
    await seedModules();
    await seedAdmin();

    const organisations = await platformDb.Organisation.findAll();
    for (const org of organisations) {
      try {
        await ensureOrganisationTenantDatabase(org);
        console.log(`✔ Tenant DB ready: ${org.slug} (${org.database_name})`);
      } catch (err) {
        console.error(`Tenant provision failed for org ${org.id}:`, err.message);
      }
    }

    const server = http.createServer(app);
    initSocketIO(server, app);

    await verifyMailTransport();

    setInterval(() => {
      checkAndExpireSubscriptions();
    }, 6 * 60 * 60 * 1000);

    checkAndExpireSubscriptions();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to bootstrap EPiC project:', err);
    process.exit(1);
  }
}

bootstrapPlatform();
