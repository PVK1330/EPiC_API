import "dotenv/config";
import { normalizePostgresDatabaseName } from "../utils/postgresDbName.js";

function dbPassword() {
  return process.env.DB_PASSWORD || process.env.DB_PASS || "";
}

/**
 * SSL for hosted Postgres (Render, etc.). Local/Docker/Hostinger VPS: set DB_SSL=false.
 */
function useSsl() {
  const flag = String(process.env.DB_SSL || "").trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "require") return true;
  if (flag === "false" || flag === "0" || flag === "disable") return false;

  const host = String(process.env.DB_HOST || "localhost").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return false;
  }

  return /render\.com|supabase|amazonaws|neon\.tech|rds\./i.test(host);
}

function resolveDbPassword() {
  const pw = dbPassword();
  // BUG-017: never ship a hardcoded fallback credential in production.
  if (!pw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DB_PASSWORD (or DB_PASS) env var is required in production");
    }
    return "postgres"; // local-dev convenience only
  }
  return pw;
}

function buildBaseConfig(databaseName) {
  const cfg = {
    username: process.env.DB_USER || "postgres",
    password: resolveDbPassword(),
    database: databaseName,
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    dialect: "postgres",
    timezone: "+05:30",
    logging: process.env.DB_LOGGING === "true",
    pool: {
      max: Number(process.env.DB_POOL_MAX || 10),
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  };

  if (useSsl()) {
    cfg.dialectOptions = {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    };
  }

  return cfg;
}

const platformDatabase = normalizePostgresDatabaseName(process.env.DB_NAME, "epic_api");
const shared = buildBaseConfig(platformDatabase);

export default {
  development: shared,
  test: {
    ...shared,
    database: normalizePostgresDatabaseName(
      process.env.DB_NAME_TEST,
      `${platformDatabase}_test`,
    ),
  },
  production: buildBaseConfig(platformDatabase),
};
