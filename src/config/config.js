import 'dotenv/config';
import { normalizePostgresDatabaseName } from '../utils/postgresDbName.js';

const platformDatabase = normalizePostgresDatabaseName(
  process.env.DB_NAME,
  'epic_api',
);

// Use SSL when connecting to a remote host (non-localhost)
const isRemoteHost = process.env.DB_HOST && !process.env.DB_HOST.includes('localhost') && process.env.DB_HOST !== '127.0.0.1';
const sslOptions = isRemoteHost
  ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
  : {};

export default {
  development: {
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "postgres",
    database: platformDatabase,
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: false,
    ...sslOptions,
  },
  test: {
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "postgres",
    database: normalizePostgresDatabaseName(process.env.DB_NAME, 'epic_api_test'),
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: false,
    ...sslOptions,
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: platformDatabase,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: false,
    ...sslOptions,
  },
};


