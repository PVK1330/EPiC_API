/**
 * Sequential workflow enforcement tests.
 *
 * Covers five areas:
 *   1. STAGE_PHASE_MAP    — every stage is mapped; phases 2 and 3 are correct.
 *   2. getActiveStageKey  — returns the first stage with any incomplete task.
 *   3. checkStatusGate    — government-pipeline stages require specific statuses.
 *   4. checkSequentialOrder — tasks in stage N are blocked by incomplete stage N-1.
 *   5. checkIntraStageOrder — later roles in a stage are blocked by incomplete
 *                             earlier roles.
 *   6. validatePhaseGate  — application status controls phase accessibility.
 *
 * Run with:  node --test tests/licenceSequentialWorkflow.test.js
 *
 * All DB interactions are replaced by minimal mock objects — no Sequelize
 * instance or database connection is required.
 */

import test from "node:test";
import assert from "node:assert";

import {
  STAGE_PHASE_MAP,
  STAGE_STATUS_GATE,
  LICENCE_STAGE_DEFINITIONS,
  stageRoleOrder,
  checkStatusGate,
  checkSequentialOrder,
  checkIntraStageOrder,
  getActiveStageKey,
} from "../src/services/licenceStageTask.service.js";

import {
  validatePhaseGate,
  WORKFLOW_TYPES,
} from "../src/services/workflowEngine.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sequelize Op stand-ins — the mocked count() ignores where clauses. */
const Op = { lt: Symbol("lt"), ne: Symbol("ne"), in: Symbol("in") };

/**
 * Build a minimal mock tenantDb. `countResult` is returned by every LicenceStageTask.count call.
 * `findAllRows` is returned by LicenceStageTask.findAll when supplied.
 */
function makeMockDb({ countResult = 0, findAllRows = [] } = {}) {
  return {
    Sequelize: { Op },
    LicenceStageTask: {
      count: async () => countResult,
      findAll: async () => findAllRows,
    },
  };
}

function stageDef(key) {
  const def = LICENCE_STAGE_DEFINITIONS.find((s) => s.key === key);
  assert.ok(def, `No stage definition found for key: ${key}`);
  return def;
}

function assertBlocked(err, expectedCode, labelSubstring) {
  assert.equal(err.statusCode, expectedCode, `Expected statusCode ${expectedCode}`);
  if (labelSubstring) {
    assert.ok(
      err.message.toLowerCase().includes(labelSubstring.toLowerCase()),
      `Expected message to include "${labelSubstring}": ${err.message}`,
    );
  }
}

// ─── 1. STAGE_PHASE_MAP ───────────────────────────────────────────────────────

test("STAGE_PHASE_MAP: all 19 stage keys have a phase entry", () => {
  const definedKeys = LICENCE_STAGE_DEFINITIONS.map((s) => s.key);
  const mappedKeys = Object.keys(STAGE_PHASE_MAP);
  assert.equal(mappedKeys.length, 19, "Expected exactly 19 entries in STAGE_PHASE_MAP");
  for (const key of definedKeys) {
    assert.ok(
      Object.hasOwn(STAGE_PHASE_MAP, key),
      `STAGE_PHASE_MAP is missing stage key: ${key}`,
    );
  }
});

test("STAGE_PHASE_MAP: stages 1–9 map to phase 2 (Application)", () => {
  const phase2Keys = [
    "enquiry_onboarding", "licence_routes", "organisation_details",
    "cos_requirements", "supporting_documents", "key_personnel",
    "declarations", "intake_information_form", "intake_document_checklist",
  ];
  for (const key of phase2Keys) {
    assert.equal(STAGE_PHASE_MAP[key], 2, `Expected ${key} → phase 2`);
  }
});

test("STAGE_PHASE_MAP: stages 10–19 map to phase 3 (Review & Approval)", () => {
  const phase3Keys = [
    "sponsor_information_provision", "government_sms_registration",
    "sponsor_portal_onboarding", "government_portal_credentials",
    "government_application_forms", "government_submission",
    "home_office_document_dispatch", "payment_confirmation",
    "submission", "decision_activation",
  ];
  for (const key of phase3Keys) {
    assert.equal(STAGE_PHASE_MAP[key], 3, `Expected ${key} → phase 3`);
  }
});

test("STAGE_PHASE_MAP: no stage maps to phase 1, 4, or 5 (those phases are outside the pipeline)", () => {
  const outsidePipeline = new Set([1, 4, 5]);
  for (const [key, phase] of Object.entries(STAGE_PHASE_MAP)) {
    assert.ok(
      !outsidePipeline.has(phase),
      `Stage "${key}" unexpectedly maps to phase ${phase}`,
    );
  }
});

// ─── 2. stageRoleOrder ───────────────────────────────────────────────────────

test("stageRoleOrder: data-entry stages use the default sponsor-first order", () => {
  const order = stageRoleOrder("supporting_documents");
  assert.equal(order[0], "sponsor");
  assert.equal(order[1], "caseworker");
  assert.equal(order[2], "admin");
});

test("stageRoleOrder: government_sms_registration uses caseworker-first order", () => {
  const order = stageRoleOrder("government_sms_registration");
  assert.equal(order[0], "caseworker");
  assert.equal(order[1], "sponsor");
  assert.equal(order[2], "admin");
});

test("stageRoleOrder: government_portal_credentials uses sponsor-first order (flow v2)", () => {
  // Flow v2: UKVI emails credentials to the sponsor, who submits them first; the
  // caseworker then reviews and the admin confirms.
  const order = stageRoleOrder("government_portal_credentials");
  assert.equal(order[0], "sponsor");
  assert.equal(order[1], "caseworker");
  assert.equal(order[2], "admin");
});

test("stageRoleOrder: unknown stage key falls back to default order", () => {
  const order = stageRoleOrder("no_such_stage");
  assert.equal(order[0], "sponsor");
});

// ─── 3. checkStatusGate ──────────────────────────────────────────────────────

test("checkStatusGate: government_sms_registration blocked when status is Pending", () => {
  const app = { status: "Pending", id: 1 };
  const def = stageDef("government_sms_registration");
  assert.throws(
    () => checkStatusGate(app, def),
    (err) => {
      assertBlocked(err, 409, "Government Processing");
      return true;
    },
  );
});

test("checkStatusGate: government_sms_registration blocked when status is Under Review", () => {
  const app = { status: "Under Review", id: 1 };
  const def = stageDef("government_sms_registration");
  assert.throws(() => checkStatusGate(app, def), { message: /Government Processing/ });
});

test("checkStatusGate: government_sms_registration allowed when status is Government Processing", () => {
  const app = { status: "Government Processing", id: 1 };
  const def = stageDef("government_sms_registration");
  assert.doesNotThrow(() => checkStatusGate(app, def));
});

test("checkStatusGate: government_sms_registration allowed when status is Decision Pending", () => {
  const app = { status: "Decision Pending", id: 1 };
  const def = stageDef("government_sms_registration");
  assert.doesNotThrow(() => checkStatusGate(app, def));
});

test("checkStatusGate: decision_activation allowed when status is Government Processing", () => {
  const app = { status: "Government Processing", id: 1 };
  const def = stageDef("decision_activation");
  assert.doesNotThrow(() => checkStatusGate(app, def));
});

test("checkStatusGate: decision_activation allowed when status is Decision Pending", () => {
  const app = { status: "Decision Pending", id: 1 };
  const def = stageDef("decision_activation");
  assert.doesNotThrow(() => checkStatusGate(app, def));
});

test("checkStatusGate: sponsor_information_provision allowed when status is Under Review", () => {
  const app = { status: "Under Review", id: 1 };
  const def = stageDef("sponsor_information_provision");
  assert.doesNotThrow(() => checkStatusGate(app, def));
});

test("checkStatusGate: sponsor_information_provision blocked when status is Pending", () => {
  const app = { status: "Pending", id: 1 };
  const def = stageDef("sponsor_information_provision");
  assert.throws(() => checkStatusGate(app, def), { message: /Under Review/ });
});

test("checkStatusGate: data-entry stages have no status gate (always pass)", () => {
  const noGateStages = [
    "enquiry_onboarding", "licence_routes", "organisation_details",
    "supporting_documents", "cos_requirements",
  ];
  const app = { status: "Draft", id: 1 };
  for (const key of noGateStages) {
    const def = stageDef(key);
    assert.doesNotThrow(
      () => checkStatusGate(app, def),
      `Expected no gate for stage: ${key}`,
    );
  }
});

// ─── 4. checkSequentialOrder ─────────────────────────────────────────────────

test("checkSequentialOrder: stage 1 (enquiry_onboarding) always passes — no predecessors", async () => {
  const db = makeMockDb({ countResult: 5 }); // count would be non-zero but it's ignored for order=1
  const def = stageDef("enquiry_onboarding");
  await assert.doesNotReject(async () => checkSequentialOrder(db, 1, def));
});

test("checkSequentialOrder: stage 2 passes when stage 1 has no incomplete tasks", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("licence_routes");
  await assert.doesNotReject(async () => checkSequentialOrder(db, 1, def));
});

test("checkSequentialOrder: stage 2 is blocked when stage 1 has 2 incomplete tasks", async () => {
  const db = makeMockDb({ countResult: 2 });
  const def = stageDef("licence_routes");
  await assert.rejects(
    async () => checkSequentialOrder(db, 1, def),
    (err) => {
      assertBlocked(err, 409, "2 task(s) remaining");
      assert.ok(err.message.includes("Licence Routes"), `Expected stage title: ${err.message}`);
      return true;
    },
  );
});

test("checkSequentialOrder: stage 11 is blocked when earlier stages have 1 incomplete task", async () => {
  const db = makeMockDb({ countResult: 1 });
  const def = stageDef("sponsor_information_provision");
  await assert.rejects(
    async () => checkSequentialOrder(db, 1, def),
    (err) => {
      assertBlocked(err, 409, "1 task(s) remaining");
      return true;
    },
  );
});

test("checkSequentialOrder: stage 18 (decision_activation) passes when no earlier tasks are incomplete", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("decision_activation");
  await assert.doesNotReject(async () => checkSequentialOrder(db, 1, def));
});

test("checkSequentialOrder: error message includes the target stage title", async () => {
  const db = makeMockDb({ countResult: 3 });
  const def = stageDef("supporting_documents");
  await assert.rejects(
    async () => checkSequentialOrder(db, 1, def),
    (err) => {
      assert.ok(err.message.includes("Supporting Documents"), err.message);
      return true;
    },
  );
});

// ─── 5. checkIntraStageOrder ─────────────────────────────────────────────────

test("checkIntraStageOrder: sponsor task (first in order) always passes — no predecessors", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("supporting_documents");
  await assert.doesNotReject(async () => checkIntraStageOrder(db, 1, def, "sponsor"));
});

test("checkIntraStageOrder: caseworker task passes when sponsor task is complete (count=1)", async () => {
  // count() returns the number of completed preceding-role tasks.
  // There is 1 preceding role (sponsor) and it is complete.
  const db = makeMockDb({ countResult: 1 });
  const def = stageDef("supporting_documents");
  await assert.doesNotReject(async () => checkIntraStageOrder(db, 1, def, "caseworker"));
});

test("checkIntraStageOrder: caseworker task is blocked when sponsor task is not complete (count=0)", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("supporting_documents");
  await assert.rejects(
    async () => checkIntraStageOrder(db, 1, def, "caseworker"),
    (err) => {
      assertBlocked(err, 409, "sponsor");
      assert.ok(err.message.includes("Supporting Documents"), err.message);
      return true;
    },
  );
});

test("checkIntraStageOrder: admin task is blocked when caseworker task is not complete", async () => {
  // For admin: preceding roles are [sponsor, caseworker]. Count returns 1 (only sponsor done).
  const db = makeMockDb({ countResult: 1 });
  const def = stageDef("supporting_documents");
  await assert.rejects(
    async () => checkIntraStageOrder(db, 1, def, "admin"),
    (err) => {
      assertBlocked(err, 409);
      return true;
    },
  );
});

test("checkIntraStageOrder: admin task passes when both sponsor and caseworker are done (count=2)", async () => {
  const db = makeMockDb({ countResult: 2 });
  const def = stageDef("supporting_documents");
  await assert.doesNotReject(async () => checkIntraStageOrder(db, 1, def, "admin"));
});

test("checkIntraStageOrder: government_sms_registration — caseworker is first, always passes", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("government_sms_registration");
  await assert.doesNotReject(async () => checkIntraStageOrder(db, 1, def, "caseworker"));
});

test("checkIntraStageOrder: government_sms_registration — sponsor blocked if caseworker task not done (count=0)", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("government_sms_registration");
  await assert.rejects(
    async () => checkIntraStageOrder(db, 1, def, "sponsor"),
    (err) => {
      assertBlocked(err, 409, "caseworker");
      return true;
    },
  );
});

test("checkIntraStageOrder: government_sms_registration — sponsor passes when caseworker done (count=1)", async () => {
  const db = makeMockDb({ countResult: 1 });
  const def = stageDef("government_sms_registration");
  await assert.doesNotReject(async () => checkIntraStageOrder(db, 1, def, "sponsor"));
});

test("checkIntraStageOrder: role not in the order array passes without DB call", async () => {
  const db = makeMockDb({ countResult: 0 });
  const def = stageDef("enquiry_onboarding");
  await assert.doesNotReject(
    async () => checkIntraStageOrder(db, 1, def, "non_existent_role")
  );
});

// ─── 6. getActiveStageKey ────────────────────────────────────────────────────

test("getActiveStageKey: returns first stage key when no rows exist", async () => {
  const db = makeMockDb({ findAllRows: [] });
  const key = await getActiveStageKey(db, 1);
  assert.equal(key, LICENCE_STAGE_DEFINITIONS[0].key);
});

test("getActiveStageKey: returns stage with first incomplete task", async () => {
  const rows = [
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "licence_routes",     stageOrder: 2, status: "completed" },
    { stageKey: "licence_routes",     stageOrder: 2, status: "pending" }, // incomplete
    { stageKey: "organisation_details", stageOrder: 3, status: "pending" },
  ];
  const db = makeMockDb({ findAllRows: rows });
  const key = await getActiveStageKey(db, 1);
  assert.equal(key, "licence_routes", "Should return the first stage with any incomplete task");
});

test("getActiveStageKey: skips fully-completed stages", async () => {
  const rows = [
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "licence_routes",     stageOrder: 2, status: "pending" },
  ];
  const db = makeMockDb({ findAllRows: rows });
  const key = await getActiveStageKey(db, 1);
  assert.equal(key, "licence_routes");
});

test("getActiveStageKey: returns null when all seeded stages are complete", async () => {
  const rows = [
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "completed" },
    { stageKey: "licence_routes",     stageOrder: 2, status: "completed" },
    { stageKey: "licence_routes",     stageOrder: 2, status: "completed" },
  ];
  const db = makeMockDb({ findAllRows: rows });
  const key = await getActiveStageKey(db, 1);
  assert.equal(key, null, "All seeded stages complete → active key should be null");
});

test("getActiveStageKey: uses stageOrder not insertion order to determine sequence", async () => {
  // Rows arrive in DB insertion order, not stage order — must sort by stageOrder.
  const rows = [
    { stageKey: "licence_routes",     stageOrder: 2, status: "pending" },
    { stageKey: "enquiry_onboarding", stageOrder: 1, status: "pending" }, // lower order, inserted later
  ];
  const db = makeMockDb({ findAllRows: rows });
  const key = await getActiveStageKey(db, 1);
  assert.equal(key, "enquiry_onboarding", "Must return lowest stageOrder with incomplete task");
});

// ─── 7. validatePhaseGate ────────────────────────────────────────────────────

test("validatePhaseGate: null applicationStatus is blocked", () => {
  const result = validatePhaseGate(null, 3);
  assert.ok(!result.valid, "Expected blocked for null status");
  assert.ok(result.message.includes("required"), result.message);
});

test("validatePhaseGate: phase 1 is always accessible", () => {
  for (const status of ["Draft", "Pending", "Rejected", "Approved"]) {
    const result = validatePhaseGate(status, 1);
    assert.ok(result.valid, `Expected phase 1 accessible for status "${status}"`);
  }
});

test("validatePhaseGate: phase 2 is always accessible for any status", () => {
  for (const status of ["Draft", "Pending", "Under Review", "Approved"]) {
    const result = validatePhaseGate(status, 2);
    assert.ok(result.valid, `Expected phase 2 accessible for status "${status}"`);
  }
});

test("validatePhaseGate: phase 3 is accessible when Under Review", () => {
  assert.ok(validatePhaseGate("Under Review", 3).valid);
});

test("validatePhaseGate: phase 3 is accessible when Government Processing", () => {
  assert.ok(validatePhaseGate("Government Processing", 3).valid);
});

test("validatePhaseGate: phase 3 is accessible when Decision Pending", () => {
  assert.ok(validatePhaseGate("Decision Pending", 3).valid);
});

test("validatePhaseGate: phase 3 is accessible when Approved", () => {
  assert.ok(validatePhaseGate("Approved", 3).valid);
});

test("validatePhaseGate: phase 3 is blocked when Draft", () => {
  const result = validatePhaseGate("Draft", 3);
  assert.ok(!result.valid);
  assert.ok(result.message.includes("Under Review"), result.message);
});

test("validatePhaseGate: phase 3 is blocked when Pending", () => {
  const result = validatePhaseGate("Pending", 3);
  assert.ok(!result.valid);
});

test("validatePhaseGate: phase 3 is blocked when Information Requested", () => {
  // Information Requested IS in the allowed set for phase 3.
  const result = validatePhaseGate("Information Requested", 3);
  assert.ok(result.valid, "Information Requested should allow phase 3");
});

test("validatePhaseGate: phase 4 is blocked unless application is Approved", () => {
  const blocked = ["Draft", "Pending", "Under Review", "Government Processing", "Decision Pending", "Rejected"];
  for (const status of blocked) {
    const result = validatePhaseGate(status, 4);
    assert.ok(!result.valid, `Expected phase 4 blocked for status "${status}"`);
    assert.ok(result.message.includes("Approved"), result.message);
  }
});

test("validatePhaseGate: phase 4 is accessible when application is Approved", () => {
  assert.ok(validatePhaseGate("Approved", 4).valid);
});

test("validatePhaseGate: phase 5 is blocked unless application is Approved", () => {
  const result = validatePhaseGate("Decision Pending", 5);
  assert.ok(!result.valid);
  assert.ok(result.message.includes("5"), result.message);
});

test("validatePhaseGate: phase 5 is accessible when application is Approved", () => {
  assert.ok(validatePhaseGate("Approved", 5).valid);
});

test("validatePhaseGate: unknown phase number returns blocked", () => {
  const result = validatePhaseGate("Approved", 99);
  assert.ok(!result.valid);
  assert.ok(result.message.includes("99"), result.message);
});

test("validatePhaseGate: string phase number is coerced correctly", () => {
  // JWT / query-string values often arrive as strings.
  assert.ok(validatePhaseGate("Approved", "4").valid);
  assert.ok(!validatePhaseGate("Pending", "4").valid);
});

// ─── 8. STAGE_STATUS_GATE coverage ───────────────────────────────────────────

test("STAGE_STATUS_GATE: all 10 government-pipeline stage keys are gated", () => {
  const expectedGatedStages = [
    "sponsor_information_provision",
    "government_sms_registration",
    "sponsor_portal_onboarding",
    "government_portal_credentials",
    "government_application_forms",
    "government_submission",
    "home_office_document_dispatch",
    "payment_confirmation",
    "submission",
    "decision_activation",
  ];
  assert.equal(Object.keys(STAGE_STATUS_GATE).length, expectedGatedStages.length);
  for (const key of expectedGatedStages) {
    assert.ok(
      Object.hasOwn(STAGE_STATUS_GATE, key),
      `STAGE_STATUS_GATE missing key: ${key}`,
    );
    assert.ok(
      STAGE_STATUS_GATE[key] instanceof Set,
      `STAGE_STATUS_GATE["${key}"] must be a Set`,
    );
  }
});

test("STAGE_STATUS_GATE: data-entry stages (1–9) are NOT in the gate", () => {
  const dataEntryStages = [
    "enquiry_onboarding", "licence_routes", "organisation_details",
    "cos_requirements", "supporting_documents", "key_personnel",
    "declarations", "intake_information_form", "intake_document_checklist",
  ];
  for (const key of dataEntryStages) {
    assert.ok(
      !Object.hasOwn(STAGE_STATUS_GATE, key),
      `Data-entry stage "${key}" should NOT be in STAGE_STATUS_GATE`,
    );
  }
});
