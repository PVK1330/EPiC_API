// Phase 2 UAT 4.2 #3: issued CCLs showed "david@Elite_pic.co.uk" (firm-name tag
// rewrote the domain before the e-mail rule ran) and a fixed adviser; some
// templates were also re-imported on every server restart. DB-free tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seedCclTemplatesFromDocxForDb,
  shouldRefreshSeededTemplate,
  CCL_SEED_VERSION,
} from "../src/seeders/cclTemplateDocx.seeder.js";
import { interpolateCclHtml } from "../src/services/cclTags.service.js";

async function seedIntoFakeDb() {
  const rows = [];
  const fakeDb = {
    VisaType: { findAll: async () => [{ id: 1, name: "Skilled Worker" }, { id: 2, name: "Indefinite Leave to Remain" }] },
    CclTemplate: {
      findAll: async () => [],
      findOrCreate: async ({ defaults }) => { rows.push(defaults); return [defaults, true]; },
    },
  };
  await seedCclTemplatesFromDocxForDb(fakeDb);
  return rows;
}

test("seeded templates never contain the adviser e-mail or a firm-name-in-email", async () => {
  const rows = await seedIntoFakeDb();
  assert.ok(rows.length >= 10, "all docx templates imported");
  for (const r of rows) {
    assert.doesNotMatch(r.bodyHtml, /@\{\{org_name\}\}|elitepic\.co\.uk|Elite_pic/i, r.name);
    assert.doesNotMatch(r.bodyHtml, /I,\s*(David Robertson|Khalid Mahmood)/, r.name);
    assert.ok(r.bodyHtml.startsWith(`<!-- ccl-seed:v${CCL_SEED_VERSION} -->`), `${r.name} carries the seed marker`);
  }
  const ilr = rows.find((r) => /Indefinite Leave/.test(r.name));
  assert.match(ilr.bodyHtml, /\{\{caseworker_email\}\}/);
  assert.match(ilr.bodyHtml, /\{\{caseworker_name\}\}/);
});

test("a template is refreshed once per seed version, never on every boot", () => {
  assert.equal(shouldRefreshSeededTemplate(`<!-- ccl-seed:v${CCL_SEED_VERSION} --><p>x</p>`), false);
  assert.equal(shouldRefreshSeededTemplate(`<!-- ccl-seed:v${CCL_SEED_VERSION - 1} --><p>x</p>`), true);
  assert.equal(shouldRefreshSeededTemplate("<p>I, David Robertson will be your caseworker</p>"), true);
  assert.equal(shouldRefreshSeededTemplate("<p>email david@{{org_name}}.co.uk</p>"), true);
  // Admin-edited template without a marker and without legacy text: leave alone.
  assert.equal(shouldRefreshSeededTemplate("<p>{{caseworker_name}} will handle your case</p>"), false);
});

test("drafts saved from old templates show the assigned caseworker, not the adviser", () => {
  const draft =
    '<p>I, David Robertson will be your caseworker and responsible. I can be contacted on 01217782400 and email ' +
    '<a href="mailto:david@{{org_name}}.co.uk">david@{{org_name}}.co.uk</a> as and when they arise.</p>' +
    "<p>Your caseworker will be Mr Khalid Mahmood.</p>";
  const out = interpolateCclHtml(draft, {
    org_name: "Elite_pic",
    caseworker_name: "Simran Kaur",
    caseworker_email: "simran@example.co.uk",
    caseworker_phone: "07000 000000",
    caseworkers_all: "Simran Kaur",
  });
  assert.doesNotMatch(out, /Elite_pic\.co\.uk|David Robertson|Khalid Mahmood|01217782400/);
  assert.match(out, /Simran Kaur/);
  assert.match(out, /simran@example\.co\.uk/);
});

// Phase 2 UAT (Test 4 follow-up): the Change of Employment .docx files are a
// real client's completed letter. No personal details may reach any template.
test("no real client details survive in any seeded template", async () => {
  const rows = await seedIntoFakeDb();
  const PERSONAL = /Jomon|Gillott|B16 0RS|Y9158089|1H9W3VKX8|Farmhouse|Farmhosue|Aluna|31500|30500|PAN ASIA|wife|Mr XXX|EPIC2026-xxx/i;
  for (const r of rows) assert.doesNotMatch(r.bodyHtml, PERSONAL, r.name);
  const coe = rows.find((r) => r.name === "Change of Employment — CCL").bodyHtml;
  assert.match(coe, /<p>\{\{candidate_name\}\}<\/p><p>\{\{candidate_address\}\}<\/p><p>Date: \{\{date_today\}\}<\/p><p>Dear \{\{candidate_first_name\}\},<\/p>/);
  assert.match(coe, /\{\{sponsor_instruction_clause\}\}/);
  assert.match(coe, /\{\{passport_number\}\}/);
  assert.match(coe, /Yours sincerely<\/p><p>\{\{caseworker_name\}\}<\/p>/);
  // ILR header placeholders (…… lines) are gone too.
  const ilr = rows.find((r) => /Indefinite Leave/.test(r.name)).bodyHtml;
  assert.doesNotMatch(ilr.split(/Re:\s*Client Care Letter/i)[0], /[_…]{4,}|\.{6,}/);
});

test("old imports with placeholder or real-client headers are refreshed; letters without a heading are not", () => {
  assert.equal(shouldRefreshSeededTemplate("<p>Mr Jomon Jose</p><p><strong>Re: Client Care Letter</strong></p>"), true);
  assert.equal(shouldRefreshSeededTemplate("<p>……………</p><p><strong>Re: Client Care Letter</strong></p>"), true);
  assert.equal(shouldRefreshSeededTemplate("<p>{{candidate_name}}</p><p><strong>Re: Client Care Letter</strong></p>"), false);
  assert.equal(shouldRefreshSeededTemplate("<p>Dear {{candidate_first_name}}</p><p>Name ______________</p>"), false);
});
