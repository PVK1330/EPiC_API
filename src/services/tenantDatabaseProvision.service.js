import pkg from "pg";
import config from "../config/config.js";
import {
  normalizePostgresDatabaseName,
  isValidPostgresDatabaseName,
} from "../utils/postgresDbName.js";
import logger from "../utils/logger.js";

const { Client } = pkg;

/** EPiC_ tenant prefix (PostgreSQL stores unquoted names as lowercase: epic_). */
export function getTenantDatabasePrefix() {
  const raw = process.env.TENANT_DB_PREFIX || "epic_";
  const prefix = String(raw).toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!prefix || !/^[a-z]/.test(prefix)) {
    return "epic_";
  }
  return prefix.endsWith("_") ? prefix : `${prefix}_`;
}

/**
 * PostgreSQL-safe database name: lowercase [a-z0-9_], max 63 chars, starts with letter.
 * Example: slug "acme" → epic_acme (EPiC_ prefix).
 * @param {string} slug
 */
export function buildPhysicalTenantDatabaseName(slug) {
  const prefix = getTenantDatabasePrefix();
  const raw = String(slug || "tenant")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const body = (raw || "tenant").replace(/^[0-9]+/, "");
  let name = `${prefix}${body}`.slice(0, 63);
  if (!/^[a-z]/.test(name)) {
    name = `${prefix}tenant_${body}`.slice(0, 63);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error("Could not derive a valid PostgreSQL database name from slug");
  }
  return name;
}

function getMaintenanceConnectionConfig() {
  const env = process.env.NODE_ENV || "development";
  const c = config[env];
  const cfg = {
    host: c.host,
    port: parseInt(String(c.port || 5432), 10),
    user: process.env.TENANT_DB_CREATOR_USER || c.username,
    password:
      process.env.TENANT_DB_CREATOR_PASSWORD ??
      c.password ??
      process.env.DB_PASSWORD ??
      process.env.DB_PASS,
    database: process.env.DB_MAINTENANCE_DATABASE || "postgres",
  };

  // Propagate SSL settings from Sequelize config to raw pg.Client connections
  if (c.dialectOptions?.ssl) {
    cfg.ssl = c.dialectOptions.ssl;
  }

  return cfg;
}

/**
 * @param {string} databaseName
 * @returns {Promise<boolean>}
 */
export async function tenantPostgresDatabaseExists(databaseName) {
  if (!databaseName) return false;
  const safeName = normalizePostgresDatabaseName(databaseName);
  if (!isValidPostgresDatabaseName(safeName)) return false;
  databaseName = safeName;
  const cfg = getMaintenanceConnectionConfig();
  const client = new Client(cfg);
  await client.connect();
  try {
    const check = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    return check.rowCount > 0;
  } finally {
    await client.end();
  }
}

/**
 * Creates an empty PostgreSQL database owned by the app DB user (requires CREATEDB or superuser).
 * @param {string} databaseName
 */
export async function createTenantPostgresDatabase(databaseName) {
  const raw = databaseName;
  databaseName = normalizePostgresDatabaseName(databaseName);
  if (!isValidPostgresDatabaseName(databaseName)) {
    throw new Error(`Invalid database name: ${raw}`);
  }
  if (raw && raw !== databaseName) {
    logger.warn(
      { raw, databaseName },
      "Normalized PostgreSQL database name (hyphens and special characters are not allowed)",
    );
  }
  const cfg = getMaintenanceConnectionConfig();
  const client = new Client(cfg);
  await client.connect();
  try {
    const check = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (check.rowCount > 0) {
      return { created: false, databaseName };
    }
    await client.query(`CREATE DATABASE ${databaseName}`);
    return { created: true, databaseName };
  } finally {
    await client.end();
  }
}

import { runTenantMigrations } from "../migrations/run.js";
import { evictTenantDb, getTenantDb } from "./tenantDb.service.js";
import { seedTenantDefaults } from "./tenantSeed.service.js";

/**
 * Create tenant DB when missing (registry may reference a dropped database).
 * @param {string} databaseName
 */
export async function ensureTenantPostgresDatabase(databaseName) {
  const exists = await tenantPostgresDatabaseExists(databaseName);
  if (exists) {
    return { created: false, databaseName };
  }
  return createTenantPostgresDatabase(databaseName);
}

/**
 * Resolve physical DB name for an org: canonical EPiC_ name, unless legacy DB still exists.
 * @param {{ slug: string, database_name?: string|null }} org
 * @returns {Promise<string>}
 */
export async function resolveOrganisationDatabaseName(org) {
  const canonicalName = buildPhysicalTenantDatabaseName(org.slug);
  const registered = org.database_name?.trim();

  if (!registered) {
    return canonicalName;
  }

  if (registered.startsWith("epic_t_")) {
    const legacyExists = await tenantPostgresDatabaseExists(registered);
    return legacyExists ? registered : canonicalName;
  }

  if (registered !== canonicalName) {
    const registeredExists = await tenantPostgresDatabaseExists(registered);
    return registeredExists ? registered : canonicalName;
  }

  return registered;
}

/**
 * Applies SQL migrations to a tenant database.
 * @param {string} databaseName
 */
export async function syncTenantDatabaseSchema(databaseName) {
  evictTenantDb(databaseName);
  await runTenantMigrations(databaseName);
  const tenantDb = getTenantDb(databaseName);
  await tenantDb.sequelize.query(
    'ALTER TABLE organisations ADD COLUMN IF NOT EXISTS smtp_settings JSONB DEFAULT NULL',
  );
  await tenantDb.sequelize.query(
    "ALTER TABLE cases ADD COLUMN IF NOT EXISTS workflow_meta JSONB DEFAULT '{}'::jsonb",
  );
  await tenantDb.sequelize.query(
    "ALTER TABLE visa_types ADD COLUMN IF NOT EXISTS ccl_template_path VARCHAR(255) DEFAULT NULL",
  );
  await tenantDb.sequelize.query(
    "ALTER TABLE visa_types ADD COLUMN IF NOT EXISTS ccl_template_name VARCHAR(255) DEFAULT NULL",
  );
  // Ensure audit_logs has the columns the Sequelize model expects
  await tenantDb.sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource VARCHAR(255)",
  );
  await tenantDb.sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Success'",
  );
  await tenantDb.sequelize.query(
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT",
  );
  await seedTenantDefaults(tenantDb).catch((err) =>
    logger.warn({ err }, "seedTenantDefaults"),
  );
  evictTenantDb(databaseName);
}

/**
 * Drops a tenant database (maintenance connection). Use only on failed provisioning rollback.
 * @param {string} databaseName
 */
export async function dropTenantPostgresDatabase(databaseName) {
  databaseName = normalizePostgresDatabaseName(databaseName, "");
  if (!isValidPostgresDatabaseName(databaseName)) return;
  const cfg = getMaintenanceConnectionConfig();
  const client = new Client(cfg);
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await client.end();
  }
}

/** Physical per-org databases (disable with TENANT_PHYSICAL_DATABASES=false). */
export function isPhysicalTenantDatabaseEnabled() {
  const flag = String(process.env.TENANT_PHYSICAL_DATABASES ?? "true").toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "off";
}

/**
 * Provision empty tenant DB + run tenant migrations.
 * @param {string} slug
 */
export async function provisionOrganisationTenantDatabase(slug) {
  const databaseName = buildPhysicalTenantDatabaseName(slug);
  const { created } = await ensureTenantPostgresDatabase(databaseName);
  await syncTenantDatabaseSchema(databaseName);
  return { databaseName, created };
}
