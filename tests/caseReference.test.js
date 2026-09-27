// Phase 2 UAT 3.3 — one standard case reference format. DB-free unit tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaseRef, caseRefNeedsReissue, generateCaseId } from "../src/utils/case.utils.js";

const fakeDb = {
  VisaType: {
    findByPk: async (id) =>
      ({ 1: { id: 1, name: "Skilled Worker", code: "SW" }, 2: { id: 2, name: "Indefinite Leave to Remain", code: "ILR" }, 3: { id: 3, name: "Graduate Visa", code: null } })[id] || null,
  },
  Organisation: { findByPk: async () => ({ id: 1, name: "Elite Pic", code: "EPIC" }) },
};

test("structured references parse; legacy formats do not", () => {
  assert.deepEqual(parseCaseRef("EPIC-ILR26-001"), { org: "EPIC", type: "ILR", year: "26", seq: "001" });
  assert.deepEqual(parseCaseRef("RV-T226-1204"), { org: "RV", type: "T2", year: "26", seq: "1204" });
  for (const legacy of ["CAS-709548", "CAS-000004", "Case-01", "C-26010001", "", null, undefined]) {
    assert.equal(parseCaseRef(legacy), null, String(legacy));
  }
});

test("legacy or missing references always need a new one", async () => {
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: "CAS-709548", visaTypeId: 2 }, { checkType: false }), true);
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: null, visaTypeId: 2 }, { checkType: false }), true);
});

test("a type code that no longer matches the case's visa type needs a new reference", async () => {
  // The client's example: ELIT-SW26-001 on an ILR case.
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: "ELIT-SW26-001", visaTypeId: 2 }), true);
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: "ELIT-ILR26-001", visaTypeId: 2 }), false);
  // A different firm prefix alone never triggers renumbering.
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: "OLDCODE-SW26-004", visaTypeId: 1 }), false);
  // Visa type without a code → derived from its name (Graduate Visa → GV).
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: "EPIC-GV26-002", visaTypeId: 3 }), false);
  // No visa type → "OTH".
  assert.equal(await caseRefNeedsReissue(fakeDb, { caseId: "EPIC-OTH26-002", visaTypeId: null }), false);
});

test("the fallback reference is unique, never a colliding Case-NN", async () => {
  const a = await generateCaseId({}, {});
  const b = await generateCaseId({}, {});
  assert.match(a, /^Case-[0-9A-Z]{8,}$/);
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /^Case-\d{2}$/);
});
