import pg from 'pg';
import "dotenv/config";
const { Client } = pg;

async function run() {
  const client = new Client({
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    host: process.env.DB_HOST || "127.0.0.1",
    port: 5432,
    database: "postgres"
  });
  
  await client.connect();
  const res = await client.query("SELECT datname FROM pg_database WHERE datname LIKE 'epic_%'");
  
  if (res.rows.length === 0) {
      console.log("No databases starting with 'epic_' found.");
  }
  
  for (const row of res.rows) {
    const db = row.datname;
    console.log(`Dropping database: ${db}...`);
    // Terminate active connections
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [db]);
    // Drop database
    await client.query(`DROP DATABASE IF EXISTS "${db}"`);
    console.log(`Successfully dropped ${db}`);
  }
  
  await client.end();
  console.log("Database reset complete.");
}

run().catch(err => {
    console.error("Failed to drop databases:", err);
    process.exit(1);
});
