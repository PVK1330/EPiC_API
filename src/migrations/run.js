/**
 * SQL migrations for platform (registry) and tenant databases.
 *
 * Usage:
 *   node src/migrations/run.js platform     — platform DB only (organisations + users)
 *   node src/migrations/run.js tenants      — all tenant DBs listed on organisations
 *   node src/migrations/run.js all          — platform then every tenant (default)
 */
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "../services/tenantDb.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Platform registry bootstrap order. */
const PLATFORM_BOOTSTRAP_ORDER = [
  "002_roles.sql",
  "003_permissions.sql",
  "004_role_permissions.sql",
  "005_users.sql",
  "001_organisations.sql",
  "platform_001_registry.sql",
  "20260514120000-add-organisations-database-name.sql",
];

/** Tenant bootstrap order (users must exist before organisation FK alters in later files). */
const TENANT_BOOTSTRAP_ORDER = [
  "002_roles.sql",
  "003_permissions.sql",
  "004_role_permissions.sql",
  "005_users.sql",
  "001_organisations.sql",
  "20260421120002-create-departments.sql",
  "006_core_business_tables.sql",
  "20260516150000-create-application-field-settings.sql",
];

function listSqlFiles(subDir) {
  const fullPath = join(__dirname, subDir);
  try {
    return readdirSync(fullPath)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(subDir, f));
  } catch (e) {
    console.warn(`Warning: Could not read directory ${fullPath}`);
    return [];
  }
}

function listOrderedSqlFiles(subDir, bootstrapOrder) {
  const fullPath = join(__dirname, subDir);
  let all;
  try {
    all = readdirSync(fullPath).filter((f) => f.endsWith(".sql"));
  } catch (e) {
    console.warn(`Warning: Could not read directory ${fullPath}`);
    return [];
  }

  const bootstrap = bootstrapOrder
    .filter((f) => all.includes(f))
    .map((f) => join(subDir, f));
  const bootstrapSet = new Set(bootstrapOrder);
  const rest = all
    .filter((f) => !bootstrapSet.has(f))
    .sort()
    .map((f) => join(subDir, f));

  return [...bootstrap, ...rest];
}

function listPlatformSqlFiles() {
  return listOrderedSqlFiles("superadmin", PLATFORM_BOOTSTRAP_ORDER);
}

function listTenantSqlFiles() {
  return listOrderedSqlFiles("tenants", TENANT_BOOTSTRAP_ORDER);
}

async function runSqlFiles(sequelize, files, label) {
  if (!files.length) {
    console.log(`No ${label} migrations found.`);
    return;
  }

  // Ensure migration tracking table exists
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS migration_history (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `);

  for (const file of files) {
    // Check if migration already executed
    const [existing] = await sequelize.query(
      "SELECT id FROM migration_history WHERE filename = ?",
      { replacements: [file], type: sequelize.QueryTypes.SELECT }
    );

    if (existing) {
      // console.log(`[${label}] Skipping already executed:`, file);
      continue;
    }

    const sql = readFileSync(join(__dirname, file), "utf8");
    console.log(`[${label}] Running:`, file);
    
    // Execute SQL
    await sequelize.query(sql);

    // Record execution
    await sequelize.query(
      "INSERT INTO migration_history (filename) VALUES (?)",
      { replacements: [file] }
    );
    
    console.log(`[${label}] OK:`, file);
  }
}

export async function runPlatformMigrations() {
  console.log("\n--- Running Platform Migrations ---");
  await platformDb.sequelize.authenticate();
  const files = listPlatformSqlFiles();
  await runSqlFiles(platformDb.sequelize, files, "platform");
}

export async function runTenantMigrations(specificDatabaseName = null) {
  const tenantFiles = listTenantSqlFiles();
  if (!tenantFiles.length) {
    console.log("No tenant migrations found.");
    return;
  }

  if (specificDatabaseName) {
    console.log(`\n--- Running Migrations for Specific Tenant: ${specificDatabaseName} ---`);
    const tenantDb = getTenantDb(specificDatabaseName);
    await tenantDb.sequelize.authenticate();
    await runSqlFiles(tenantDb.sequelize, tenantFiles, specificDatabaseName);
    return;
  }

  const orgs = await platformDb.Organisation.findAll({
    where: { database_name: { [Op.ne]: null } },
    attributes: ["id", "slug", "database_name"],
  });

  for (const org of orgs) {
    if (!org.database_name) continue;
    console.log(`\n--- Tenant: ${org.slug} (${org.database_name}) ---`);
    const tenantDb = getTenantDb(org.database_name);
    await tenantDb.sequelize.authenticate();
    await runSqlFiles(tenantDb.sequelize, tenantFiles, org.slug);
  }
}

async function run() {
  const mode = (process.argv[2] || "all").toLowerCase();

  try {
    if (mode === "platform") {
      await runPlatformMigrations();
    } else if (mode === "tenants") {
      await platformDb.sequelize.authenticate();
      await runTenantMigrations();
    } else if (mode === "all") {
      await runPlatformMigrations();
      await runTenantMigrations();
    } else {
      console.error(`Unknown mode "${mode}". Use: platform | tenants | all`);
      process.exit(1);
    }

    console.log("\nMigrations finished.");
  } catch (err) {
    console.error("\nMigration failed:");
    console.error(err);
    process.exit(1);
  } finally {
    // Only close if we are running as a standalone script
    if (process.argv[1].endsWith('run.js')) {
        await platformDb.sequelize.close();
    }
  }
}

// Only auto-run if called directly
if (process.argv[1] && (process.argv[1].endsWith('run.js') || process.argv[1].endsWith('run'))) {
    run().catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
