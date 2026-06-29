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
import logger from "../utils/logger.js";

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
    logger.warn(`Warning: Could not read directory ${fullPath}`);
    return [];
  }
}

function listOrderedSqlFiles(subDir, bootstrapOrder) {
  const fullPath = join(__dirname, subDir);
  let all;
  try {
    all = readdirSync(fullPath).filter((f) => f.endsWith(".sql"));
  } catch (e) {
    logger.warn(`Warning: Could not read directory ${fullPath}`);
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
  const superadminFiles = listOrderedSqlFiles("superadmin", PLATFORM_BOOTSTRAP_ORDER);
  const platformFiles = listSqlFiles("platform");
  return [...superadminFiles, ...platformFiles];
}

function listTenantSqlFiles() {
  return listOrderedSqlFiles("tenants", TENANT_BOOTSTRAP_ORDER);
}

/** Stable migration keys across Windows/Linux (always forward slashes). */
function migrationKey(file) {
  return String(file).replace(/\\/g, "/");
}

/**
 * Split a SQL file into top-level statements, ignoring semicolons inside
 * single/double-quoted strings, line comments (--) and block comments.
 * Good enough for our migration SQL (no PL/pgSQL bodies / dollar-quoting here).
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/**
 * Execute a SQL file. Statements using CREATE/DROP INDEX CONCURRENTLY cannot
 * run inside a transaction block, and Sequelize wraps multi-statement query
 * strings in an implicit transaction. So when a file contains CONCURRENTLY we
 * split it and run each statement as its own autocommit query.
 */
async function executeSqlFile(sequelize, sql) {
  if (!/\bCONCURRENTLY\b/i.test(sql)) {
    await sequelize.query(sql);
    return;
  }

  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    // Each query() call is its own implicit autocommit transaction, so a lone
    // CONCURRENTLY statement is no longer inside a transaction block.
    await sequelize.query(statement);
  }
}

async function runSqlFiles(sequelize, files, label) {
  if (!files.length) {
    logger.info(`No ${label} migrations found.`);
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

  await sequelize.query(`
    UPDATE migration_history
    SET filename = REPLACE(filename, '\\', '/')
    WHERE filename LIKE '%\\%';
  `);

  const seen = new Set();
  for (const file of files) {
    const key = migrationKey(file);
    if (seen.has(key)) continue;
    seen.add(key);

    const existingRows = await sequelize.query(
      "SELECT id FROM migration_history WHERE filename = $1 LIMIT 1",
      { bind: [key], type: sequelize.QueryTypes.SELECT },
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;

    if (existing) {
      continue;
    }

    const sql = readFileSync(join(__dirname, file), "utf8");
    logger.info({ key }, `[${label}] Running`);

    await executeSqlFile(sequelize, sql);

    await sequelize.query(
      `INSERT INTO migration_history (filename) VALUES ($1)
       ON CONFLICT (filename) DO NOTHING`,
      { bind: [key] },
    );

    logger.info({ key }, `[${label}] OK`);
  }
}

export async function runPlatformMigrations() {
  logger.info("\n--- Running Platform Migrations ---");
  await platformDb.sequelize.authenticate();
  const files = listPlatformSqlFiles();
  await runSqlFiles(platformDb.sequelize, files, "platform");
}

export async function runTenantMigrations(specificDatabaseName = null) {
  const tenantFiles = listTenantSqlFiles();
  if (!tenantFiles.length) {
    logger.info("No tenant migrations found.");
    return;
  }

  if (specificDatabaseName) {
    logger.info(`\n--- Running Migrations for Specific Tenant: ${specificDatabaseName} ---`);
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
    logger.info(`\n--- Tenant: ${org.slug} (${org.database_name}) ---`);
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
      logger.error(`Unknown mode "${mode}". Use: platform | tenants | all`);
      process.exit(1);
    }

    logger.info("\nMigrations finished.");
  } catch (err) {
    logger.error({ err }, "\nMigration failed");
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
      logger.error({ err }, "Migration run failed");
      process.exit(1);
    });
}
