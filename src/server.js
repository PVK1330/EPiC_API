// Must be set before any other import so every new Date() uses IST.
process.env.TZ = process.env.TZ || "Asia/Kolkata";

import "dotenv/config";

// ── CRITICAL: Validate mandatory env vars BEFORE anything else ────────────────
// NOTE: validateRequiredEnv still uses console.* because it runs BEFORE the
// logger is initialised (the logger itself depends on env vars being valid).
import { validateRequiredEnv } from "./utils/validateEnv.js";
validateRequiredEnv();

import logger from "./utils/logger.js";
import app from "./app.js";
import platformDb from "./models/index.js";
import { seedPlans } from "./seeders/plan.seeder.js";
import seedAdmin from "./seeders/admin.seeder.js";
import { seedRolesForDb } from "./seeders/role.seeder.js";
import { seedPermissionsForDb } from "./seeders/permission.seeder.js";
import { seedModules } from "./seeders/module.seeder.js";
import { seedPlatformRbacForDb } from "./seeders/platformRbac.seeder.js";
import seedPlatformAuditLogs from "./seeders/platformAuditLog.seeder.js";
import seedPlatformNotifications from "./seeders/platformNotification.seeder.js";
import {
  createTenantPostgresDatabase,
  ensureTenantPostgresDatabase,
  resolveOrganisationDatabaseName,
  syncTenantDatabaseSchema,
} from "./services/tenantDatabaseProvision.service.js";
import { runPlatformMigrations } from "./migrations/run.js";
import { getTenantDb } from "./services/tenantDb.service.js";
import {
  seedTenantDefaults,
  seedTenantOrganisation,
} from "./services/tenantSeed.service.js";
import { checkAndExpireSubscriptions } from "./services/subscriptionExpiry.service.js";
import { runComplianceAlerts } from "./services/complianceAlerts.service.js";
import http from "http";
import { initSocketIO } from "./realtime/socketServer.js";
import { normalizePostgresDatabaseName } from "./utils/postgresDbName.js";
import { verifyMailTransport } from "./services/mail.service.js";
import { logCorsConfiguration } from "./config/frontendOrigins.js";
import { ensureAdminHasAllPermissions } from "./seeders/permission.seeder.js";

const PORT = process.env.PORT || 5000;

async function ensureOrganisationTenantDatabase(org) {
  const databaseName = await resolveOrganisationDatabaseName(org);

  if (org.database_name !== databaseName) {
    await org.update({ database_name: databaseName });
  }

  const { created } = await ensureTenantPostgresDatabase(databaseName);
  if (created) {
    logger.info({ databaseName }, 'Created tenant database');
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
      "epic_central",
    );
    logger.info({ centralDbName }, 'Ensuring platform database exists');
    const dbResult = await createTenantPostgresDatabase(centralDbName);
    if (dbResult.created) {
      logger.info({ centralDbName }, 'Created new platform database');
    } else {
      logger.info({ centralDbName }, 'Platform database verified');
    }

    await platformDb.sequelize.authenticate();
    logger.info('Platform database connected');

    await runPlatformMigrations();
    logger.info('Platform SQL migrations applied');

    await seedRolesForDb(platformDb);
    await seedPermissionsForDb(platformDb);
    await seedPlatformRbacForDb(platformDb);

    await seedPlans();
    await seedModules();
    await seedAdmin();
    await seedPlatformAuditLogs();
    await seedPlatformNotifications();

    const organisations = await platformDb.Organisation.findAll();
    for (const org of organisations) {
      try {
        const tenantDb = await ensureOrganisationTenantDatabase(org);
        await ensureAdminHasAllPermissions(tenantDb);
        logger.info({ orgSlug: org.slug, databaseName: org.database_name }, 'Tenant DB ready');
      } catch (err) {
        logger.error({ err, orgId: org.id }, 'Tenant provision failed');
      }
    }

    logCorsConfiguration();
    logger.info(
      { timezone: process.env.TZ },
      `Timezone configured`,
    );

    const server = http.createServer(app);
    initSocketIO(server, app);

    await verifyMailTransport();

    setInterval(
      () => {
        checkAndExpireSubscriptions();
      },
      6 * 60 * 60 * 1000,
    );

    checkAndExpireSubscriptions();

    setInterval(
      () => {
        runComplianceAlerts();
      },
      24 * 60 * 60 * 1000,
    );

    runComplianceAlerts();

    server.listen(PORT, () => {
      logger.info({ port: PORT }, 'Server started');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to bootstrap EPiC project');
    process.exit(1);
  }
}

bootstrapPlatform();
