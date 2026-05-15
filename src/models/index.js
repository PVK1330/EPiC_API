import { Sequelize } from "sequelize";
import config from "../config/config.js";
import { buildDb } from "./buildDb.js";

const env = process.env.NODE_ENV || "development";
const dbConfig = config[env];

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  dbConfig,
);

const db = buildDb(sequelize);

export default db;
