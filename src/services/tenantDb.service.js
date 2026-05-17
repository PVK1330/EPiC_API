import { LRUCache } from "lru-cache";
import { Sequelize } from "sequelize";
import config from "../config/config.js";
import { buildDb } from "../models/tenantModels.js";

const cache = new LRUCache({
  max: 50,
  ttl: 10 * 60 * 1000,
  dispose: (value) => {
    if (value?.sequelize) {
      value.sequelize.close().catch(() => {});
    }
  },
});

/**
 * LRU cache of live Sequelize model registries keyed by physical database name.
 */
export function getTenantDb(databaseName) {
  if (!databaseName) throw new Error("databaseName required");
  if (cache.has(databaseName)) return cache.get(databaseName);

  const env = process.env.NODE_ENV || "development";
  const c = config[env];
  const seq = new Sequelize(databaseName, c.username, c.password, {
    host: c.host,
    port: c.port,
    dialect: "postgres",
    logging: false,
    pool: c.pool ?? { max: 5, min: 0, acquire: 30000, idle: 10000 },
    ...(c.dialectOptions ? { dialectOptions: c.dialectOptions } : {}),
  });

  const db = buildDb(seq);
  cache.set(databaseName, db);
  return db;
}

export function evictTenantDb(databaseName) {
  cache.delete(databaseName);
}
