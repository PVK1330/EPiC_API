const { Client } = require('pg');

async function test() {
  const client = new Client('postgres://postgres:postgres@localhost:5432/epic_platform');
  await client.connect();
  const res = await client.query('SELECT id, email, role_id, role_name FROM "Users" ORDER BY id DESC LIMIT 5');
  console.log('Platform Users:', res.rows);

  const tenantClient = new Client('postgres://postgres:postgres@localhost:5432/epic_tenant_pvk1330_epic_new_panels');
  await tenantClient.connect();
  const res2 = await tenantClient.query('SELECT id, email, role_id FROM "Users" ORDER BY id DESC LIMIT 5');
  console.log('Tenant Users:', res2.rows);

  process.exit(0);
}
test().catch(console.error);
