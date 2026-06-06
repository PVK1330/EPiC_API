import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VISA_DOCUMENT_CHECKLISTS,
  deriveIsRequired,
  deriveCategory,
  deriveDocumentType,
  normaliseVisaName,
} from "../src/constants/visaDocumentChecklists.js";
import seedDocumentChecklists from "../src/seeders/documentChecklist.seeder.js";
import seedWorkflowEmailTemplates from "../src/seeders/workflowEmailTemplates.seeder.js";
import seedCclTemplates from "../src/seeders/cclTemplate.seeder.js";
import seedCclTemplatesFromDocx from "../src/seeders/cclTemplateDocx.seeder.js";

// ── Fake tenant DB helpers ────────────────────────────────────────────────────
function fakeVisaTypeStore(names) {
  let vt = 0;
  const rows = names.map((n) => ({ id: ++vt, name: n }));
  return {
    rows,
    model: {
      async findAll() {
        return rows.map((r) => ({ id: r.id, name: r.name }));
      },
      async findByPk(id) {
        return rows.find((r) => r.id === id) || null;
      },
      async findOne({ where }) {
        return rows.find((r) => r.name === where.name) || null;
      },
      async findOrCreate({ where, defaults }) {
        let r = rows.find((x) => x.name === where.name);
        if (r) return [r, false];
        r = { id: ++vt, name: defaults.name };
        rows.push(r);
        return [r, true];
      },
    },
  };
}

function fakeTableStore(matchKeys) {
  let id = 0;
  const rows = [];
  return {
    rows,
    model: {
      async findAll({ where } = {}) {
        if (!where) return rows;
        return rows.filter((r) =>
          Object.entries(where).every(([k, v]) => (v && v[Symbol.for("nodejs.util.inspect.custom")] ? true : r[k] === v)),
        );
      },
      async findOne({ where }) {
        return rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) || null;
      },
      async findOrCreate({ where, defaults }) {
        const found = rows.find((r) => matchKeys.every((k) => r[k] === where[k]));
        if (found) return [found, false];
        const row = { id: ++id, ...defaults, async update(p) { Object.assign(this, p); } };
        rows.push(row);
        return [row, true];
      },
    },
  };
}

const DEFAULT_VISA_NAMES = [
  "Skilled Worker",
  "Indefinite Leave to Remain (ILR)",
  "Spouse / Partner",
  "Graduate",
  "Student",
  "Visitor",
  "Global Talent",
];

// ── Visa checklist data ───────────────────────────────────────────────────────
test("visa checklist data: 9 groups, sensible required/category parsing", () => {
  assert.equal(VISA_DOCUMENT_CHECKLISTS.length, 9);
  assert.equal(deriveIsRequired("Passport copy"), true);
  assert.equal(deriveIsRequired("ATAS certificate (if applicable)"), false);
  assert.equal(deriveCategory("Last 6 months' bank statements"), "financial");
  assert.equal(deriveCategory("Certificate of Sponsorship (CoS)"), "work");
  assert.equal(deriveCategory("Tuberculosis certificate (if applicable)"), "medical");
  assert.equal(deriveDocumentType("Details for the individual: full name, phone"), "Details for the individual");
  assert.equal(normaliseVisaName("Skilled Worker"), "skilledworker");
});

test("documentChecklist seeder: matches/creates visa types, idempotent", async () => {
  const visa = fakeVisaTypeStore(DEFAULT_VISA_NAMES);
  const checklist = fakeTableStore(["visaTypeId", "documentName", "caseId"]);
  const db = { VisaType: visa.model, DocumentChecklist: checklist.model };

  await seedDocumentChecklists(db);
  const firstCount = checklist.rows.length;
  assert.ok(firstCount > 100, `expected >100 checklist items, got ${firstCount}`);
  // creates the missing visa types referenced by the lists
  assert.ok(visa.rows.some((v) => /Sponsor Licence/i.test(v.name)));
  assert.ok(visa.rows.some((v) => /Dependent/i.test(v.name)));

  await seedDocumentChecklists(db); // re-run
  assert.equal(checklist.rows.length, firstCount, "seeder must be idempotent");
});

// ── Workflow email templates ──────────────────────────────────────────────────
test("email template seeder: seeds full bodies, upgrades legacy, preserves custom", async () => {
  // fresh tenant
  const fresh = fakeTableStore(["template_key"]);
  await seedWorkflowEmailTemplates({ EmailTemplateSetting: fresh.model });
  const dcs = fresh.rows.find((r) => r.template_key === "data_capture_request");
  assert.match(dcs.body, /eVisa share code/);
  assert.ok(fresh.rows.find((r) => r.template_key === "further_information_request"));

  // legacy default → upgraded
  const legacy = fakeTableStore(["template_key"]);
  legacy.rows.push({
    id: 99,
    template_key: "ccl_issued",
    subject: "[{{firm_name}}] Client Care Letter",
    body: "Dear {{client_name}},\n\nPlease find your Client Care Letter attached. Sign and return a copy at your earliest convenience.\n\nKind regards,\n{{caseworker_name}}",
    async update(p) { Object.assign(this, p); },
  });
  await seedWorkflowEmailTemplates({ EmailTemplateSetting: legacy.model });
  assert.match(legacy.rows.find((r) => r.template_key === "ccl_issued").body, /Immigration Advice Authority/);

  // admin-customised → preserved
  const custom = fakeTableStore(["template_key"]);
  custom.rows.push({
    id: 1, template_key: "ccl_issued", subject: "x", body: "Our bespoke wording.",
    async update(p) { Object.assign(this, p); },
  });
  await seedWorkflowEmailTemplates({ EmailTemplateSetting: custom.model });
  assert.equal(custom.rows.find((r) => r.template_key === "ccl_issued").body, "Our bespoke wording.");
});

// ── CCL templates ─────────────────────────────────────────────────────────────
test("default CCL template seeder: creates one org default, idempotent", async () => {
  const ccl = fakeTableStore(["visaTypeId"]);
  // findOne for the "existing default" check
  ccl.model.findOne = async ({ where }) => ccl.rows.find((r) => (where.visaTypeId?.constructor ? r.visaTypeId == null : r.visaTypeId === where.visaTypeId)) || null;
  ccl.model.create = async (d) => { const r = { id: ccl.rows.length + 1, ...d }; ccl.rows.push(r); return r; };
  const db = { CclTemplate: ccl.model };
  await seedCclTemplates(db);
  assert.equal(ccl.rows.length, 1);
  assert.equal(ccl.rows[0].visaTypeId, null);
  await seedCclTemplates(db);
  assert.equal(ccl.rows.length, 1, "default CCL seeder must be idempotent");
});

test("docx CCL importer: imports 10 letters, one active per visa slot", async () => {
  const visa = fakeVisaTypeStore([
    ...DEFAULT_VISA_NAMES,
    "Sponsor Licence",
    "Dependent Visa",
    "British Citizenship / Naturalisation",
  ]);
  let id = 0;
  const rows = [];
  const db = {
    VisaType: visa.model,
    CclTemplate: {
      async findAll({ where }) {
        return rows.filter((r) => (where?.isActive ? r.isActive : true)).map((r) => ({ visaTypeId: r.visaTypeId }));
      },
      async findOrCreate({ where, defaults }) {
        const found = rows.find((r) => r.name === where.name);
        if (found) return [found, false];
        const row = { id: ++id, ...defaults, async update(p) { Object.assign(this, p); } };
        rows.push(row);
        return [row, true];
      },
    },
  };
  await seedCclTemplatesFromDocx(db);
  assert.equal(rows.length, 10, "should import all 10 .docx letters");
  // No two active templates share a visa slot
  const activeByVisa = {};
  for (const r of rows.filter((x) => x.isActive && x.visaTypeId != null)) {
    assert.ok(!activeByVisa[r.visaTypeId], "only one active template per visa type");
    activeByVisa[r.visaTypeId] = true;
  }
  // tags injected
  assert.ok(rows.some((r) => r.bodyHtml.includes("{{candidate_name}}")));
});
