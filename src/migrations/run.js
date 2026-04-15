/**
 * Runs SQL migrations in order (filenames sorted).
 * Usage: node src/migrations/run.js
 */
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import db from "../models/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No .sql migrations found in", __dirname);
    process.exit(0);
  }

  for (const file of files) {
    const full = join(__dirname, file);
    const sql = readFileSync(full, "utf8");
    console.log("Running:", file);
    await db.sequelize.query(sql);
    console.log("OK:", file);
  }

  await db.sequelize.close();
  console.log("Migrations finished.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
