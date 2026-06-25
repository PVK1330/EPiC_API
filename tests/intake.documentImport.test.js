// Tests: Stage 4 (Appendix A) → Stage 10 (intake) document auto-import.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_TO_APPENDIX_MAP,
  INTAKE_DOC_SOURCE,
  MANDATORY_DOCUMENTS,
  planAppendixImports,
  importMatchingAppendixDocuments,
} from "../src/services/licenceIntake.service.js";

// ─── Mapping integrity ──────────────────────────────────────────────────────

test("every mapped intake key is a real mandatory intake document", () => {
  const mandatoryKeys = new Set(MANDATORY_DOCUMENTS.map((d) => d.key));
  for (const intakeKey of Object.keys(INTAKE_TO_APPENDIX_MAP)) {
    assert.ok(
      mandatoryKeys.has(intakeKey),
      `${intakeKey} in INTAKE_TO_APPENDIX_MAP is not a mandatory intake document`,
    );
  }
});

test("the named-person + org-chart documents now map to their Stage 4 equivalents", () => {
  // Step 4 (Appendix A) now collects these too, so they auto-import into the
  // intake checklist instead of requiring a second manual upload.
  assert.deepEqual(INTAKE_TO_APPENDIX_MAP.id_proof_named_person, ["id_proof_named_person"]);
  assert.deepEqual(INTAKE_TO_APPENDIX_MAP.right_to_work_named_person, ["right_to_work_named_person"]);
  assert.deepEqual(INTAKE_TO_APPENDIX_MAP.organisational_chart, ["organisational_chart"]);
});

test("every mandatory intake document has a Stage 4 mapping", () => {
  for (const d of MANDATORY_DOCUMENTS) {
    assert.ok(
      Array.isArray(INTAKE_TO_APPENDIX_MAP[d.key]) && INTAKE_TO_APPENDIX_MAP[d.key].length > 0,
      `mandatory document ${d.key} must map to a Stage 4 appendix key`,
    );
  }
});

test("certificate_of_incorporation maps to the appendix proof_of_registration key", () => {
  assert.deepEqual(INTAKE_TO_APPENDIX_MAP.certificate_of_incorporation, ["proof_of_registration"]);
});

// ─── planAppendixImports: selection rules ───────────────────────────────────

const appendix = (over = {}) => ({
  id: 1,
  documentKey: "employer_liability_insurance",
  filePath: "/storage/private/eli.pdf",
  verificationStatus: "Pending",
  ...over,
});
const intake = (over = {}) => ({
  documentKey: "employer_liability_insurance",
  status: "pending",
  filePath: null,
  ...over,
});

test("imports a pending intake slot when a usable appendix upload exists", () => {
  const plan = planAppendixImports([intake()], [appendix()]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].intakeDoc.documentKey, "employer_liability_insurance");
  assert.equal(plan[0].appendixDoc.id, 1);
});

test("maps across differing keys (certificate_of_incorporation ← proof_of_registration)", () => {
  const plan = planAppendixImports(
    [intake({ documentKey: "certificate_of_incorporation" })],
    [appendix({ id: 7, documentKey: "proof_of_registration" })],
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].appendixDoc.id, 7);
});

test("skips when the appendix document has no uploaded file", () => {
  const plan = planAppendixImports([intake()], [appendix({ filePath: null })]);
  assert.equal(plan.length, 0);
});

test("skips when the appendix document was rejected", () => {
  const plan = planAppendixImports([intake()], [appendix({ verificationStatus: "Rejected" })]);
  assert.equal(plan.length, 0);
});

test("never touches an intake slot the sponsor already populated", () => {
  const uploaded = planAppendixImports([intake({ status: "uploaded" })], [appendix()]);
  assert.equal(uploaded.length, 0);
  const verified = planAppendixImports([intake({ status: "verified" })], [appendix()]);
  assert.equal(verified.length, 0);
  const hasFile = planAppendixImports([intake({ filePath: "/already/there.pdf" })], [appendix()]);
  assert.equal(hasFile.length, 0);
});

test("now imports the named-person documents that gained a Stage 4 mapping", () => {
  const plan = planAppendixImports(
    [intake({ documentKey: "id_proof_named_person" })],
    [appendix({ documentKey: "id_proof_named_person" })],
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].intakeDoc.documentKey, "id_proof_named_person");
});

test("skips intake documents that have no Stage 4 mapping (e.g. conditional docs)", () => {
  const plan = planAppendixImports(
    [intake({ documentKey: "food_hygiene_certificate" })],
    [appendix({ documentKey: "food_hygiene_certificate" })],
  );
  assert.equal(plan.length, 0);
});

// ─── importMatchingAppendixDocuments: persistence + flags ───────────────────

function mockDb(intakeDocs, appendixDocs) {
  return {
    LicenceIntakeDocument: { findAll: async () => intakeDocs },
    LicenceAppendixDocument: { findAll: async () => appendixDocs },
  };
}

test("import marks the slot uploaded + imported and links the appendix id", async () => {
  let saved = false;
  const slot = {
    documentKey: "paye_hmrc_registration",
    status: "pending",
    filePath: null,
    save: async function () { saved = true; },
  };
  const app = {
    id: 99,
    documentKey: "paye_hmrc_registration",
    filePath: "/storage/private/paye.pdf",
    verificationStatus: "Pending",
  };

  const count = await importMatchingAppendixDocuments(mockDb([slot], [app]), 42);

  assert.equal(count, 1);
  assert.ok(saved, "the intake slot must be persisted");
  assert.equal(slot.status, "uploaded");
  assert.equal(slot.source, INTAKE_DOC_SOURCE.IMPORTED);
  assert.equal(slot.sourceAppendixDocumentId, 99);
  assert.equal(slot.filePath, "/storage/private/paye.pdf");
  assert.equal(slot.fileName, "paye.pdf");
});

test("import carries over an already-verified appendix status onto the intake slot", async () => {
  const slot = {
    documentKey: "paye_hmrc_registration",
    status: "pending",
    filePath: null,
    save: async function () {},
  };
  const app = {
    id: 7,
    documentKey: "paye_hmrc_registration",
    filePath: "/storage/private/paye.pdf",
    verificationStatus: "Verified",
    verifiedBy: 5,
  };

  const count = await importMatchingAppendixDocuments(mockDb([slot], [app]), 1);

  assert.equal(count, 1);
  assert.equal(slot.status, "verified", "a verified appendix doc must land on the checklist as verified");
  assert.equal(slot.verifiedByUserId, 5);
  assert.equal(slot.sourceAppendixDocumentId, 7);
});

test("import is a no-op when models are missing (defensive)", async () => {
  const count = await importMatchingAppendixDocuments({}, 1);
  assert.equal(count, 0);
});
