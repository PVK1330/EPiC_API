import pg from 'pg';

const client = new pg.Client({
  host: '72.61.188.186',
  port: 5432,
  user: 'epic',
  password: 'epic123',
  database: 'epic',
  connectionTimeoutMillis: 5000,
});

async function run() {
  await client.connect();
  console.log('Connected to epic platform db!');
  const orgs = await client.query('SELECT id, name, slug, database_name FROM organisations;');
  console.log('Organisations:', orgs.rows);
  await client.end();
}

run().catch(console.error);
