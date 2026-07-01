import fs from 'fs';
import pg from 'pg';
const { Client } = pg;
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const base = { host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD || env.DB_PASS };
async function q(db, s){ const c=new Client({...base,database:db}); await c.connect(); const r=await c.query(s); await c.end(); return r.rows; }
async function tableExists(db, t){ const r = await q(db, `SELECT 1 FROM information_schema.tables WHERE table_name='${t}'`); return r.length>0; }
for (const db of ['epic_uat_qa_org','epic_chatterbox','epic_elite_visa_solutions','epic_asdfgh','epic_mau','epic_regression_test_org']) {
  try {
    const rows = await q(db, `SELECT c."caseId", c."totalAmount" tot, c."paidAmount" paid, c."amountStatus" st, r.status ccl
      FROM cases c LEFT JOIN case_ccl_records r ON r.case_id=c.id
      WHERE c."totalAmount" > 0 OR c."paidAmount" > 0 ORDER BY c."caseId"`);
    console.log(`\n=== ${db} (cases with fees/payments) ===`);
    for (const x of rows) console.log(`  ${x.caseId}  tot=${x.tot} paid=${x.paid} status=${x.st} ccl=${x.ccl}`);
    // cross-check case_payments sum
    if (await tableExists(db, 'case_payments')) {
      const sums = await q(db, `SELECT c."caseId", COALESCE(SUM(p.amount),0) psum, COUNT(p.id) n FROM cases c JOIN case_payments p ON p.case_id=c.id WHERE p.status='completed' GROUP BY c."caseId"`);
      for (const s of sums) console.log(`     payments: ${s.caseId} completed_sum=${s.psum} count=${s.n}`);
    }
  } catch(e){ console.log(`${db} err: ${e.message}`); }
}
