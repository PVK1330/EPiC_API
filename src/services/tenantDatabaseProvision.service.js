import pkg from "pg";
import { Sequelize } from "sequelize";
import config from "../config/config.js";
import { buildDb } from "../models/buildDb.js";

const { Client } = pkg;

/**
 * PostgreSQL-safe database name: lowercase [a-z0-9_], max 63 chars, starts with letter.
 * @param {string} slug
 */
export function buildPhysicalTenantDatabaseName(slug) {
  const raw = String(slug || "tenant")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const body = (raw || "tenant").replace(/^[0-9]+/, "");
  let name = `epic_t_${body}`.slice(0, 63);
  if (!/^[a-z]/.test(name)) {
    name = `epic_t_tenant_${body}`.slice(0, 63);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error("Could not derive a valid PostgreSQL database name from slug");
  }
  return name;
}

function getMaintenanceConnectionConfig() {
  const env = process.env.NODE_ENV || "development";
  const c = config[env];
  return {
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
}

/**
 * Creates an empty PostgreSQL database owned by the app DB user (requires CREATEDB or superuser).
 * @param {string} databaseName
 */
export async function createTenantPostgresDatabase(databaseName) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error(`Invalid database name: ${databaseName}`);
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

/**
 * Applies Sequelize schema (sync) to a tenant database. Closes the connection when done.
 * @param {string} databaseName
 */
export async function syncTenantDatabaseSchema(databaseName) {
  const env = process.env.NODE_ENV || "development";
  const c = config[env];
  const tenantSeq = new Sequelize(databaseName, c.username, c.password, {
    host: c.host,
    port: c.port,
    dialect: "postgres",
    logging: false,
  });
  buildDb(tenantSeq);
  await tenantSeq.sync();
  await tenantSeq.close();
}

/**
 * Drops a tenant database (maintenance connection). Use only on failed provisioning rollback.
 * @param {string} databaseName
 */
export async function dropTenantPostgresDatabase(databaseName) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) return;
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
