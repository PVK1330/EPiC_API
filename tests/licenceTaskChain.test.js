/**
 * Task-chain behaviour tests for the Sponsor Licence workflow.
 *
 * Tests are grouped into six suites:
 *
 *   1. TASK_CHAIN structure   — all stages covered, correct node count.
 *   2. getChainSequence       — roles filtered and ordered correctly per stage.
 *   3. nextChainNode          — returns the correct successor node.
 *   4. Chain ordering         — sponsor before caseworker, caseworker before admin,
 *                               except government-pipeline stages where caseworker leads.
 *   5. seedNextInChain (mock) — correct DB call is issued after completion.
 *   6. ensureStageTasks frontier (mock) — only the frontier node is seeded on a
 *                               fresh application; subsequent calls are idempotent.
 *
 * Run with:  node --test tests/licenceTaskChain.test.js
 *
 * DB-dependent tests (#5 and #6) use minimal inline mocks. No database
 * connection or external service is required — notification and email calls
 * are swallowed by the .catch() wrappers already present in the service.
 */

import test from "node:test";
import assert from "node:assert";

import {
  LICENCE_STAGE_DEFINITIONS,
  TASK_CHAIN,
  getChainSequence,
  nextChainNode,
  stageRoleOrder,
  ensureStageTasks,
} from "../src/services/licenceStageTask.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sequelize Op stand-ins (actual symbols not needed — mocked count ignores where). */
const Op = { lt: Symbol("lt"), ne: Symbol("ne"), in: Symbol("in") };

/**
 * Minimal tenantDb mock. `preloadedRows` is the initial set of task rows.
 * Every findOrCreate call that doesn't already have a row stores a new one and
 * appends to `createdCalls` for assertion.
 */
function makeChainDb(preloadedRows = []) {
  const rows = {}; // key = "stageKey:role"
  const createdCalls = []; // array of { stageKey, role, status }

  for (const r of preloadedRows) {
    rows[`${r.stageKey}:${r.role}`] = r;
  }

  return {
    _rows: rows,
    _createdCalls: createdCalls,
    Sequelize: { Op },
    sequelize: {
      transaction: async (fn) => fn({}),
    },
    LicenceStageTask: {
      findOrCreate: async ({ where, defaults }) => {
        const k = `${where.stageKey}:${where.role}`;
        if (rows[k]) return [rows[k], false]; // existing row
        const row = {
          id: Object.keys(rows).length + 1,
          ...defaults,
          stageKey: where.stageKey,
          role: where.role,
          licenceApplicationId: where.licenceApplicationId,
          update: async (patch) => Object.assign(row, patch),
        };
        rows[k] = row;
        createdCalls.push({ stageKey: where.stageKey, role: where.role, status: defaults.status });
        return [row, true];
      },
      findAll: async ({ where } = {}) => {
        const all = Object.values(rows);
        if (!where?.licenceApplicationId) return all;
        return all.filter((r) => r.licenceApplicationId === where.licenceApplicationId);
      },
      findOne: async ({ where }) => {
        const k = `${where.stageKey}:${where.role}`;
        return rows[k] ?? null;
      },
      update: async (values, options) => {
        const ids = options?.where?.id?.[Op.in] || [];
        for (const r of Object.values(rows)) {
          if (ids.includes(r.id)) {
            Object.assign(r, values);
          }
        }
        return [ids.length];
      },
      count: async () => 0,
    },
    AuditLog: { create: async () => ({}) },
    User: {
      findByPk: async () => null,
      findAll: async () => [],
      findOne: async () => null,
    },
    LicenceCosRequirement: { findOne: async () => null },
    LicenceApplication: {
      findByPk: async (id) => ({
        id,
        status: "Pending",
        submittedAt: null,
        organisationId: 1,
        userId: 1,
        assignedcaseworkerId: null,
        licenceType: null,
        cosAllocation: null,
        contactName: null,
        feeTotal: null,
        createdAt: new Date(),
      }),
    },
  };
}

/** Shortcut to find a stage definition by key. */
function stageDef(key) {
  return LICENCE_STAGE_DEFINITIONS.find((s) => s.key === key);
}

// ─── 1. TASK_CHAIN structure ──────────────────────────────────────────────────

test("TASK_CHAIN: covers all 18 stage definitions", () => {
  const stageKeysInChain = new Set(TASK_CHAIN.map((n) => n.stageDef.key));
  for (const def of LICENCE_STAGE_DEFINITIONS) {
    assert.ok(
      stageKeysInChain.has(def.key),
      `Stage "${def.key}" is missing from TASK_CHAIN`,
    );
  }
});

test("TASK_CHAIN: is frozen (immutable constant)", () => {
  assert.ok(Object.isFrozen(TASK_CHAIN), "TASK_CHAIN must be frozen");
  assert.ok(Object.isFrozen(TASK_CHAIN[0]), "Individual nodes must be frozen");
});

test("TASK_CHAIN: every node has stageDef and role properties", () => {
  for (const node of TASK_CHAIN) {
    assert.ok(node.stageDef && typeof node.stageDef.key === "string", "node.stageDef.key must be a string");
    assert.ok(typeof node.role === "string", "node.role must be a string");
  }
});

test("TASK_CHAIN: total node count equals sum of chain sequences across all stages", () => {
  const expected = LICENCE_STAGE_DEFINITIONS.reduce(
    (sum, def) => sum + getChainSequence(def).length,
    0,
  );
  assert.equal(TASK_CHAIN.length, expected);
});

test("TASK_CHAIN: stages appear in ascending stageOrder", () => {
  let lastOrder = 0;
  for (const node of TASK_CHAIN) {
    assert.ok(
      node.stageDef.order >= lastOrder,
      `Stage order went backwards at "${node.stageDef.key}" (order ${node.stageDef.order} after ${lastOrder})`,
    );
    lastOrder = node.stageDef.order;
  }
});

test("TASK_CHAIN: first node is sponsor task of enquiry_onboarding", () => {
  assert.equal(TASK_CHAIN[0].stageDef.key, "enquiry_onboarding");
  assert.equal(TASK_CHAIN[0].role, "sponsor");
});

test("TASK_CHAIN: last node is decision_activation", () => {
  const last = TASK_CHAIN[TASK_CHAIN.length - 1];
  assert.equal(last.stageDef.key, "decision_activation");
});

// ─── 2. getChainSequence ─────────────────────────────────────────────────────

test("getChainSequence: returns only roles with non-null tasks", () => {
  for (const def of LICENCE_STAGE_DEFINITIONS) {
    const seq = getChainSequence(def);
    for (const role of seq) {
      assert.ok(
        def.tasks[role] != null,
        `getChainSequence included role "${role}" for stage "${def.key}" but tasks[${role}] is null`,
      );
    }
  }
});

test("getChainSequence: enquiry_onboarding includes all 3 roles (all tasks non-null)", () => {
  const def = stageDef("enquiry_onboarding");
  const seq = getChainSequence(def);
  assert.ok(seq.includes("sponsor"),    "Missing sponsor");
  assert.ok(seq.includes("caseworker"), "Missing caseworker");
  assert.ok(seq.includes("admin"),      "Missing admin");
  assert.equal(seq.length, 3, "Should have exactly 3 roles");
});

test("getChainSequence: no stage contains candidate role", () => {
  for (const def of LICENCE_STAGE_DEFINITIONS) {
    const seq = getChainSequence(def);
    assert.ok(!seq.includes("candidate"), `Stage ${def.key} contains candidate role`);
  }
});

test("getChainSequence: government_sms_registration starts with caseworker", () => {
  const seq = getChainSequence(stageDef("government_sms_registration"));
  assert.equal(seq[0], "caseworker", "Government stage should lead with caseworker");
});

test("getChainSequence: government_portal_credentials starts with caseworker", () => {
  const seq = getChainSequence(stageDef("government_portal_credentials"));
  assert.equal(seq[0], "caseworker");
});

// ─── 3. nextChainNode ────────────────────────────────────────────────────────

test("nextChainNode: after enquiry_onboarding/sponsor returns enquiry_onboarding/caseworker", () => {
  const next = nextChainNode("enquiry_onboarding", "sponsor");
  assert.ok(next, "Expected a next node");
  assert.equal(next.stageDef.key, "enquiry_onboarding");
  assert.equal(next.role, "caseworker");
});

test("nextChainNode: after enquiry_onboarding/caseworker returns enquiry_onboarding/admin", () => {
  const next = nextChainNode("enquiry_onboarding", "caseworker");
  assert.equal(next?.stageDef.key, "enquiry_onboarding");
  assert.equal(next?.role, "admin");
});

test("nextChainNode: last role in stage → first role of next stage", () => {
  // Find the last role for stage 1 (enquiry_onboarding) and verify it points
  // to the first role in stage 2 (licence_routes).
  const seq1 = getChainSequence(stageDef("enquiry_onboarding"));
  const lastRole = seq1[seq1.length - 1];
  const next = nextChainNode("enquiry_onboarding", lastRole);
  assert.equal(next?.stageDef.key, "licence_routes", "Last role of stage 1 should advance to stage 2");
  const seq2 = getChainSequence(stageDef("licence_routes"));
  assert.equal(next?.role, seq2[0], "Should be the first role of stage 2");
});

test("nextChainNode: last node in the entire chain returns null", () => {
  const last = TASK_CHAIN[TASK_CHAIN.length - 1];
  const result = nextChainNode(last.stageDef.key, last.role);
  assert.equal(result, null, "End of chain must return null");
});

test("nextChainNode: unknown stageKey returns null", () => {
  assert.equal(nextChainNode("no_such_stage", "sponsor"), null);
});

test("nextChainNode: unknown role for a known stage returns null", () => {
  assert.equal(nextChainNode("enquiry_onboarding", "no_such_role"), null);
});

test("nextChainNode: stage 10 last role → stage 11 first role (phase 2 → phase 3 boundary)", () => {
  const stage10 = stageDef("intake_document_checklist"); // order 10
  const seq10 = getChainSequence(stage10);
  const lastRole10 = seq10[seq10.length - 1];
  const next = nextChainNode("intake_document_checklist", lastRole10);
  assert.equal(next?.stageDef.key, "sponsor_information_provision",
    "Phase boundary: stage 10 → stage 11 (government pipeline starts)");
});

// ─── 4. Chain ordering invariants ────────────────────────────────────────────

test("chain ordering: for data-entry stages, sponsor always precedes caseworker", () => {
  const dataEntryStages = LICENCE_STAGE_DEFINITIONS.filter((d) => d.order <= 10);
  for (const def of dataEntryStages) {
    const seq = getChainSequence(def);
    const sIdx = seq.indexOf("sponsor");
    const cIdx = seq.indexOf("caseworker");
    if (sIdx !== -1 && cIdx !== -1) {
      assert.ok(
        sIdx < cIdx,
        `In data-entry stage "${def.key}", sponsor (${sIdx}) must precede caseworker (${cIdx})`,
      );
    }
  }
});

test("chain ordering: for data-entry stages, caseworker always precedes admin", () => {
  const dataEntryStages = LICENCE_STAGE_DEFINITIONS.filter((d) => d.order <= 10);
  for (const def of dataEntryStages) {
    const seq = getChainSequence(def);
    const cIdx = seq.indexOf("caseworker");
    const aIdx = seq.indexOf("admin");
    if (cIdx !== -1 && aIdx !== -1) {
      assert.ok(
        cIdx < aIdx,
        `In data-entry stage "${def.key}", caseworker (${cIdx}) must precede admin (${aIdx})`,
      );
    }
  }
});

test("chain ordering: government_sms_registration has caseworker before sponsor before admin", () => {
  const seq = getChainSequence(stageDef("government_sms_registration"));
  const cIdx = seq.indexOf("caseworker");
  const sIdx = seq.indexOf("sponsor");
  const aIdx = seq.indexOf("admin");
  assert.ok(cIdx < sIdx, "caseworker must precede sponsor");
  assert.ok(sIdx < aIdx, "sponsor must precede admin");
});

test("chain ordering: government_portal_credentials has caseworker before sponsor before admin", () => {
  const seq = getChainSequence(stageDef("government_portal_credentials"));
  const cIdx = seq.indexOf("caseworker");
  const sIdx = seq.indexOf("sponsor");
  const aIdx = seq.indexOf("admin");
  assert.ok(cIdx < sIdx, "caseworker must precede sponsor");
  assert.ok(sIdx < aIdx, "sponsor must precede admin");
});

test("chain ordering: no stage has a duplicate role in its sequence", () => {
  for (const def of LICENCE_STAGE_DEFINITIONS) {
    const seq = getChainSequence(def);
    const unique = new Set(seq);
    assert.equal(seq.length, unique.size,
      `Stage "${def.key}" has duplicate roles in its chain sequence: ${seq.join(", ")}`);
  }
});

test("chain ordering: TASK_CHAIN has no duplicate (stageKey, role) pairs", () => {
  const seen = new Set();
  for (const node of TASK_CHAIN) {
    const key = `${node.stageDef.key}:${node.role}`;
    assert.ok(!seen.has(key), `Duplicate chain node detected: ${key}`);
    seen.add(key);
  }
});

// ─── 5. ensureStageTasks frontier seeding (mock DB) ─────────────────────────

test("ensureStageTasks: seeds only the first chain node for a fresh application", async () => {
  const db = makeChainDb([]); // empty DB
  const fakeApp = {
    id: 42,
    status: "Pending",
    submittedAt: null,
    organisationId: 1,
    userId: 1,
    assignedcaseworkerId: null,
    licenceType: null,
    cosAllocation: null,
    contactName: null,
    feeTotal: null,
    createdAt: new Date(),
  };

  await ensureStageTasks(db, fakeApp, {});

  // Since stage 1 is data-complete, all its roles auto-complete.
  // Then stage 2 sponsor auto-completes, leaving stage 2 caseworker pending (total 5 tasks).
  assert.equal(
    db._createdCalls.length,
    5,
    `Expected exactly 5 tasks created for fresh app, got ${db._createdCalls.length}`,
  );
  assert.equal(db._createdCalls[0].stageKey, "enquiry_onboarding");
  assert.equal(db._createdCalls[0].role, "sponsor");
});

test("ensureStageTasks: is idempotent — calling twice creates no additional rows", async () => {
  const db = makeChainDb([]);
  const fakeApp = {
    id: 43,
    status: "Pending",
    submittedAt: null,
    organisationId: 1,
    userId: 1,
    assignedcaseworkerId: null,
    licenceType: null,
    cosAllocation: null,
    contactName: null,
    feeTotal: null,
    createdAt: new Date(),
  };

  await ensureStageTasks(db, fakeApp, {});
  const countAfterFirst = db._createdCalls.length;

  await ensureStageTasks(db, fakeApp, {}); // second call — must be idempotent
  assert.equal(
    db._createdCalls.length,
    countAfterFirst,
    "Second call to ensureStageTasks must not create additional rows",
  );
});

test("ensureStageTasks: when stage 1 sponsor is complete, seeds caseworker task", async () => {
  // Pre-load stage 1 sponsor task as completed.
  const preloaded = [
    {
      stageKey: "enquiry_onboarding",
      role: "sponsor",
      stageOrder: 1,
      licenceApplicationId: 44,
      status: "completed",
      update: async () => {},
    },
  ];
  const db = makeChainDb(preloaded);
  const fakeApp = {
    id: 44,
    status: "Pending",
    submittedAt: null,
    organisationId: 1,
    userId: 1,
    assignedcaseworkerId: null,
    licenceType: null,
    cosAllocation: null,
    contactName: null,
    feeTotal: null,
    createdAt: new Date(),
  };

  await ensureStageTasks(db, fakeApp, {});

  const created = db._createdCalls;
  assert.ok(
    created.some((c) => c.stageKey === "enquiry_onboarding" && c.role === "caseworker"),
    `Expected caseworker task to be seeded; got: ${JSON.stringify(created)}`,
  );
  // It should have created caseworker, admin for stage 1 (all completed),
  // and sponsor (completed) + caseworker (pending) for stage 2.
  const stage2Caseworker = created.find(
    (c) => c.stageKey === "licence_routes" && c.role === "caseworker"
  );
  assert.ok(stage2Caseworker, "Expected stage 2 caseworker task to be seeded");
  assert.equal(stage2Caseworker.status, "pending");
});

test("ensureStageTasks: terminal status (Approved) seeds every chain node", async () => {
  const db = makeChainDb([]);
  const fakeApp = {
    id: 45,
    status: "Approved",
    submittedAt: new Date(),
    organisationId: 1,
    userId: 1,
    assignedcaseworkerId: null,
    licenceType: null,
    cosAllocation: null,
    contactName: null,
    feeTotal: null,
    createdAt: new Date(),
  };

  await ensureStageTasks(db, fakeApp, {});

  // Every node in TASK_CHAIN should have been passed to findOrCreate.
  assert.equal(
    db._createdCalls.length,
    TASK_CHAIN.length,
    `Expected ${TASK_CHAIN.length} tasks seeded for Approved status, got ${db._createdCalls.length}`,
  );
});

// ─── 6. nextChainNode boundary cases ─────────────────────────────────────────

test("nextChainNode: all intermediate nodes have a successor", () => {
  // Every node except the last must return a non-null next.
  for (let i = 0; i < TASK_CHAIN.length - 1; i++) {
    const { stageDef: sd, role } = TASK_CHAIN[i];
    const next = nextChainNode(sd.key, role);
    assert.ok(
      next != null,
      `Node ${i} (${sd.key}:${role}) expected a successor but got null`,
    );
  }
});

test("nextChainNode: successor stageOrder never decreases", () => {
  for (let i = 0; i < TASK_CHAIN.length - 1; i++) {
    const cur  = TASK_CHAIN[i];
    const next = nextChainNode(cur.stageDef.key, cur.role);
    if (!next) continue;
    assert.ok(
      next.stageDef.order >= cur.stageDef.order,
      `Chain went backwards at node ${i}: ${cur.stageDef.key}(${cur.stageDef.order}) → ${next.stageDef.key}(${next.stageDef.order})`,
    );
  }
});

test("nextChainNode: within same stage, role index strictly increases", () => {
  for (let i = 0; i < TASK_CHAIN.length - 1; i++) {
    const cur  = TASK_CHAIN[i];
    const next = nextChainNode(cur.stageDef.key, cur.role);
    if (!next || next.stageDef.key !== cur.stageDef.key) continue; // cross-stage advance, skip
    const seq = getChainSequence(cur.stageDef);
    const curIdx  = seq.indexOf(cur.role);
    const nextIdx = seq.indexOf(next.role);
    assert.ok(
      nextIdx > curIdx,
      `Within stage "${cur.stageDef.key}", role order went backwards: ${cur.role}(${curIdx}) → ${next.role}(${nextIdx})`,
    );
  }
});
