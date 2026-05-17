import 'dotenv/config';
import { normalizePostgresDatabaseName } from '../utils/postgresDbName.js';

const platformDatabase = normalizePostgresDatabaseName(
  process.env.DB_NAME,
  'epic_api',
);

export default {
  development: {
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "postgres",
    database: platformDatabase,
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: false,
  },
  test: {
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "postgres",
    database: normalizePostgresDatabaseName(process.env.DB_NAME, 'epic_api_test'),
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: false,
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: platformDatabase,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: false,
  },
};
