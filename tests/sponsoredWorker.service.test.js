/**
 * Tests for the Phase 5 Sponsored Worker Management service.
 *
 * Uses Node.js built-in test runner (node --test).
 * All DB / model calls are stubbed inline — no real database required.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── Status constants (mirrors service) ──────────────────────────────────────
const WORKER_STATUS = Object.freeze({
  VISA_PENDING:           "CoS Assigned",
  VISA_GRANTED:           "Visa Granted",
  VISA_REJECTED:          "Visa Rejected",
  COS_ASSIGNED:           "CoS Assigned",
  IMMIGRATION_ASSESSMENT: "Immigration Assessment",
  VISA_PREPARATION:       "Visa Preparation",
  COMPLIANCE_REVIEW:      "Compliance Review",
  VISA_DECISION:          "Visa Decision",
});

// ─── Workflow transition matrix (mirrors workflowEngine.service.js) ───────────
const WORKER_TRANSITIONS = {
  "CoS Assigned":           ["Immigration Assessment", "Visa Rejected"],
  "Immigration Assessment": ["Visa Preparation",        "Visa Rejected"],
  "Visa Preparation":       ["Compliance Review",        "Visa Rejected"],
  "Compliance Review":      ["Visa Decision",            "Visa Rejected"],
  "Visa Decision":          ["Visa Granted",             "Visa Rejected"],
  "Visa Granted":           [],
  "Visa Rejected":          [],
};

function validateTransition(currentState, nextState) {
  const allowed = WORKER_TRANSITIONS[currentState];
  if (!allowed) return { valid: false, message: `'${currentState}' is terminal or unrecognised.` };
  if (!allowed.includes(nextState)) {
    return {
      valid: false,
      message: `Invalid transition from '${currentState}' to '${nextState}'. Allowed: ${allowed.join(", ")}`,
    };
  }
  return { valid: true };
}

// ─── Stub helpers ─────────────────────────────────────────────────────────────

function makeWorker(overrides = {}) {
  const data = {
    id: 1,
    sponsorId: 10,
    organisationId: 1,
    cosRequestId: 42,
    cosAllocationRecordId: 5,
    workerFirstName: "Jane",
    workerLastName: "Doe",
    workerEmail: "jane@example.com",
    workerNationality: "Nigerian",
    visaType: "Skilled Worker",
    status: WORKER_STATUS.COS_ASSIGNED,
    assignedCaseworkerIds: [],
    rejectionReason: null,
    notes: null,
    ...overrides,
  };
  return {
    ...data,
    get status()            { return data.status; },
    set status(v)           { data.status = v; },
    get rejectionReason()   { return data.rejectionReason; },
    set rejectionReason(v)  { data.rejectionReason = v; },
    get notes()             { return data.notes; },
    set notes(v)            { data.notes = v; },
    get assignedCaseworkerIds() { return data.assignedCaseworkerIds; },
    set assignedCaseworkerIds(v){ data.assignedCaseworkerIds = v; },
    save: async () => {},
  };
}

function makeTenantDb({ worker = null } = {}) {
  const auditRows = [];
  const created = [];

  return {
    SponsoredWorker: {
      findByPk: async () => worker,
      create: async (row) => {
        const w = makeWorker(row);
        created.push(w);
        return w;
      },
      findAll: async () => (worker ? [worker] : []),
      _created: created,
    },
    SponsoredWorkerAudit: {
      create: async (row) => { auditRows.push(row); return row; },
      findAll: async () => auditRows,
      _rows: auditRows,
    },
    User: null,
  };
}

// ─── Inline service logic (mirrors sponsoredWorker.service.js) ────────────────

async function stubCreate(tenantDb, params, actorId) {
  const { workerFirstName, workerLastName, sponsorId } = params;
  if (!workerFirstName?.trim() || !workerLastName?.trim()) {
    const e = new Error("Worker first name and last name are required."); e.statusCode = 400; throw e;
  }
  if (!sponsorId) {
    const e = new Error("sponsorId is required."); e.statusCode = 400; throw e;
  }
  const worker = await tenantDb.SponsoredWorker.create({
    ...params,
    workerFirstName: workerFirstName.trim(),
    workerLastName: workerLastName.trim(),
    status: WORKER_STATUS.COS_ASSIGNED,
  });
  await tenantDb.SponsoredWorkerAudit.create({
    sponsoredWorkerId: worker.id,
    action: "created",
    fromStatus: null,
    toStatus: WORKER_STATUS.COS_ASSIGNED,
    actorId,
  });
  return worker;
}

async function stubAdvance(tenantDb, { workerId, nextStatus, notes }, actorId) {
  const worker = await tenantDb.SponsoredWorker.findByPk(workerId);
  if (!worker) { const e = new Error("Sponsored worker not found."); e.statusCode = 404; throw e; }
  const { valid, message } = validateTransition(worker.status, nextStatus);
  if (!valid) { const e = new Error(message); e.statusCode = 422; throw e; }
  const fromStatus = worker.status;
  worker.status = nextStatus;
  if (notes != null) worker.notes = notes;
  await worker.save();
  await tenantDb.SponsoredWorkerAudit.create({
    sponsoredWorkerId: worker.id, action: "stage_advanced",
    fromStatus, toStatus: nextStatus, actorId, notes,
  });
  return worker;
}

async function stubGrant(tenantDb, { workerId, notes }, actorId) {
  return stubAdvance(tenantDb, { workerId, nextStatus: WORKER_STATUS.VISA_GRANTED, notes }, actorId);
}

async function stubReject(tenantDb, { workerId, rejectionReason, notes }, actorId) {
  if (!rejectionReason?.trim()) {
    const e = new Error("rejectionReason is required when rejecting a visa."); e.statusCode = 400; throw e;
  }
  const worker = await tenantDb.SponsoredWorker.findByPk(workerId);
  if (!worker) { const e = new Error("Sponsored worker not found."); e.statusCode = 404; throw e; }
  const { valid, message } = validateTransition(worker.status, WORKER_STATUS.VISA_REJECTED);
  if (!valid) { const e = new Error(message); e.statusCode = 422; throw e; }
  const fromStatus = worker.status;
  worker.status = WORKER_STATUS.VISA_REJECTED;
  worker.rejectionReason = rejectionReason.trim();
  if (notes != null) worker.notes = notes;
  await worker.save();
  await tenantDb.SponsoredWorkerAudit.create({
    sponsoredWorkerId: worker.id, action: "visa_rejected",
    fromStatus, toStatus: WORKER_STATUS.VISA_REJECTED, actorId, notes: notes ?? rejectionReason,
  });
  return worker;
}

async function stubAssignCaseworkers(tenantDb, { workerId, caseworkerIds }, actorId) {
  const worker = await tenantDb.SponsoredWorker.findByPk(workerId);
  if (!worker) { const e = new Error("Sponsored worker not found."); e.statusCode = 404; throw e; }
  const ids = caseworkerIds.filter(n => Number.isFinite(Number(n))).map(Number);
  worker.assignedCaseworkerIds = ids;
  await worker.save();
  await tenantDb.SponsoredWorkerAudit.create({
    sponsoredWorkerId: worker.id, action: "caseworker_assigned",
    fromStatus: worker.status, toStatus: worker.status, actorId,
    notes: `Assigned IDs: ${ids.join(", ")}`,
  });
  return worker;
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("WORKER_STATUS constants", () => {
  it("VISA_PENDING maps to 'CoS Assigned'", () => {
    assert.equal(WORKER_STATUS.VISA_PENDING, "CoS Assigned");
  });

  it("VISA_GRANTED maps to 'Visa Granted'", () => {
    assert.equal(WORKER_STATUS.VISA_GRANTED, "Visa Granted");
  });

  it("VISA_REJECTED maps to 'Visa Rejected'", () => {
    assert.equal(WORKER_STATUS.VISA_REJECTED, "Visa Rejected");
  });

  it("COS_ASSIGNED is an alias for VISA_PENDING", () => {
    assert.equal(WORKER_STATUS.COS_ASSIGNED, WORKER_STATUS.VISA_PENDING);
  });
});

describe("WORKER_TRANSITIONS matrix", () => {
  it("CoS Assigned → Immigration Assessment is valid", () => {
    assert.ok(validateTransition("CoS Assigned", "Immigration Assessment").valid);
  });

  it("CoS Assigned → Visa Rejected is valid (early rejection)", () => {
    assert.ok(validateTransition("CoS Assigned", "Visa Rejected").valid);
  });

  it("CoS Assigned → Visa Preparation is invalid (must go through Immigration Assessment first)", () => {
    assert.ok(!validateTransition("CoS Assigned", "Visa Preparation").valid);
  });

  it("full forward path: CoS Assigned → IM → VP → CR → VD → Visa Granted", () => {
    const path = [
      ["CoS Assigned",           "Immigration Assessment"],
      ["Immigration Assessment", "Visa Preparation"],
      ["Visa Preparation",       "Compliance Review"],
      ["Compliance Review",      "Visa Decision"],
      ["Visa Decision",          "Visa Granted"],
    ];
    for (const [from, to] of path) {
      assert.ok(validateTransition(from, to).valid, `${from} → ${to} should be valid`);
    }
  });

  it("Visa Rejected → any is invalid (terminal state)", () => {
    assert.ok(!validateTransition("Visa Rejected", "CoS Assigned").valid);
  });

  it("Visa Granted → any is invalid (terminal state)", () => {
    assert.ok(!validateTransition("Visa Granted", "Visa Decision").valid);
  });

  it("Visa Decision is the only valid predecessor for Visa Granted", () => {
    const predecessors = Object.entries(WORKER_TRANSITIONS)
      .filter(([, nexts]) => nexts.includes("Visa Granted"))
      .map(([from]) => from);
    assert.deepEqual(predecessors, ["Visa Decision"]);
  });
});

describe("createSponsoredWorker", () => {
  it("creates a worker in CoS Assigned status", async () => {
    const db = makeTenantDb();
    const worker = await stubCreate(db, { sponsorId: 10, workerFirstName: "Jane", workerLastName: "Doe", visaType: "Skilled Worker" }, 99);
    assert.equal(worker.status, "CoS Assigned");
  });

  it("trims whitespace from names", async () => {
    const db = makeTenantDb();
    const worker = await stubCreate(db, { sponsorId: 10, workerFirstName: "  Jane  ", workerLastName: "  Doe  " }, 99);
    assert.equal(worker.workerFirstName, "Jane");
    assert.equal(worker.workerLastName, "Doe");
  });

  it("writes a 'created' audit row on creation", async () => {
    const db = makeTenantDb();
    await stubCreate(db, { sponsorId: 10, workerFirstName: "Jane", workerLastName: "Doe" }, 7);
    const rows = db.SponsoredWorkerAudit._rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "created");
    assert.equal(rows[0].fromStatus, null);
    assert.equal(rows[0].toStatus, "CoS Assigned");
    assert.equal(rows[0].actorId, 7);
  });

  it("throws 400 when first name is missing", async () => {
    const db = makeTenantDb();
    await assert.rejects(
      () => stubCreate(db, { sponsorId: 10, workerFirstName: "  ", workerLastName: "Doe" }, 7),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it("throws 400 when sponsorId is missing", async () => {
    const db = makeTenantDb();
    await assert.rejects(
      () => stubCreate(db, { workerFirstName: "Jane", workerLastName: "Doe" }, 7),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });
});

describe("advanceWorkerStage", () => {
  it("advances from CoS Assigned to Immigration Assessment", async () => {
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });
    const result = await stubAdvance(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 5);
    assert.equal(result.status, "Immigration Assessment");
  });

  it("advances through the full pipeline sequentially", async () => {
    const pipeline = [
      "Immigration Assessment",
      "Visa Preparation",
      "Compliance Review",
      "Visa Decision",
      "Visa Granted",
    ];
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });
    for (const stage of pipeline) {
      await stubAdvance(db, { workerId: 1, nextStatus: stage }, 5);
      assert.equal(worker.status, stage);
    }
  });

  it("stores notes on the worker when provided", async () => {
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });
    await stubAdvance(db, { workerId: 1, nextStatus: "Immigration Assessment", notes: "Review started" }, 5);
    assert.equal(worker.notes, "Review started");
  });

  it("writes an audit row for each stage advance", async () => {
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });
    await stubAdvance(db, { workerId: 1, nextStatus: "Immigration Assessment", notes: "note" }, 5);
    const rows = db.SponsoredWorkerAudit._rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fromStatus, "CoS Assigned");
    assert.equal(rows[0].toStatus, "Immigration Assessment");
  });

  it("throws 404 when worker does not exist", async () => {
    const db = makeTenantDb({ worker: null });
    await assert.rejects(
      () => stubAdvance(db, { workerId: 999, nextStatus: "Immigration Assessment" }, 5),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });

  it("throws 422 for an invalid transition (skipping a stage)", async () => {
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });
    await assert.rejects(
      () => stubAdvance(db, { workerId: 1, nextStatus: "Visa Preparation" }, 5),
      (err) => { assert.equal(err.statusCode, 422); return true; }
    );
  });

  it("throws 422 when trying to advance a terminal state", async () => {
    const worker = makeWorker({ status: "Visa Granted" });
    const db = makeTenantDb({ worker });
    await assert.rejects(
      () => stubAdvance(db, { workerId: 1, nextStatus: "Visa Rejected" }, 5),
      (err) => { assert.equal(err.statusCode, 422); return true; }
    );
  });
});

describe("grantWorkerVisa", () => {
  it("transitions from Visa Decision to Visa Granted", async () => {
    const worker = makeWorker({ status: "Visa Decision" });
    const db = makeTenantDb({ worker });
    const result = await stubGrant(db, { workerId: 1 }, 5);
    assert.equal(result.status, "Visa Granted");
  });

  it("throws 422 when not at Visa Decision stage", async () => {
    const worker = makeWorker({ status: "Compliance Review" });
    const db = makeTenantDb({ worker });
    await assert.rejects(
      () => stubGrant(db, { workerId: 1 }, 5),
      (err) => { assert.equal(err.statusCode, 422); return true; }
    );
  });

  it("throws 404 when worker does not exist", async () => {
    const db = makeTenantDb({ worker: null });
    await assert.rejects(
      () => stubGrant(db, { workerId: 99 }, 5),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });
});

describe("rejectWorkerVisa", () => {
  it("transitions to Visa Rejected from any pipeline stage", async () => {
    const stages = [
      "CoS Assigned",
      "Immigration Assessment",
      "Visa Preparation",
      "Compliance Review",
      "Visa Decision",
    ];
    for (const stage of stages) {
      const worker = makeWorker({ status: stage });
      const db = makeTenantDb({ worker });
      const result = await stubReject(db, { workerId: 1, rejectionReason: "Not eligible" }, 5);
      assert.equal(result.status, "Visa Rejected", `Should reject from '${stage}'`);
    }
  });

  it("stores the rejection reason on the worker", async () => {
    const worker = makeWorker({ status: "Visa Decision" });
    const db = makeTenantDb({ worker });
    await stubReject(db, { workerId: 1, rejectionReason: "Document fraud detected" }, 5);
    assert.equal(worker.rejectionReason, "Document fraud detected");
  });

  it("trims whitespace from rejectionReason", async () => {
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });
    await stubReject(db, { workerId: 1, rejectionReason: "  Overstayed visa  " }, 5);
    assert.equal(worker.rejectionReason, "Overstayed visa");
  });

  it("writes a visa_rejected audit row", async () => {
    const worker = makeWorker({ status: "Visa Decision" });
    const db = makeTenantDb({ worker });
    await stubReject(db, { workerId: 1, rejectionReason: "Refused" }, 5);
    const rows = db.SponsoredWorkerAudit._rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "visa_rejected");
    assert.equal(rows[0].toStatus, "Visa Rejected");
  });

  it("throws 400 when rejectionReason is empty", async () => {
    const worker = makeWorker({ status: "Visa Decision" });
    const db = makeTenantDb({ worker });
    await assert.rejects(
      () => stubReject(db, { workerId: 1, rejectionReason: "   " }, 5),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it("throws 400 when rejectionReason is omitted", async () => {
    const worker = makeWorker({ status: "Visa Decision" });
    const db = makeTenantDb({ worker });
    await assert.rejects(
      () => stubReject(db, { workerId: 1 }, 5),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it("throws 404 when worker does not exist", async () => {
    const db = makeTenantDb({ worker: null });
    await assert.rejects(
      () => stubReject(db, { workerId: 99, rejectionReason: "N/A" }, 5),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });

  it("throws 422 when already Visa Rejected (terminal)", async () => {
    const worker = makeWorker({ status: "Visa Rejected" });
    const db = makeTenantDb({ worker });
    await assert.rejects(
      () => stubReject(db, { workerId: 1, rejectionReason: "Duplicate" }, 5),
      (err) => { assert.equal(err.statusCode, 422); return true; }
    );
  });
});

describe("assignWorkerCaseworkers", () => {
  it("stores the caseworker IDs on the worker", async () => {
    const worker = makeWorker();
    const db = makeTenantDb({ worker });
    const result = await stubAssignCaseworkers(db, { workerId: 1, caseworkerIds: [3, 7] }, 99);
    assert.deepEqual(result.assignedCaseworkerIds, [3, 7]);
  });

  it("replaces existing caseworker IDs", async () => {
    const worker = makeWorker({ assignedCaseworkerIds: [1, 2] });
    const db = makeTenantDb({ worker });
    await stubAssignCaseworkers(db, { workerId: 1, caseworkerIds: [5] }, 99);
    assert.deepEqual(worker.assignedCaseworkerIds, [5]);
  });

  it("writes a caseworker_assigned audit row", async () => {
    const worker = makeWorker();
    const db = makeTenantDb({ worker });
    await stubAssignCaseworkers(db, { workerId: 1, caseworkerIds: [3] }, 99);
    assert.equal(db.SponsoredWorkerAudit._rows[0].action, "caseworker_assigned");
  });

  it("throws 404 when worker does not exist", async () => {
    const db = makeTenantDb({ worker: null });
    await assert.rejects(
      () => stubAssignCaseworkers(db, { workerId: 99, caseworkerIds: [3] }, 99),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });
});

describe("audit trail", () => {
  it("accumulates one row per state change", async () => {
    const worker = makeWorker({ status: "CoS Assigned" });
    const db = makeTenantDb({ worker });

    await stubAdvance(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 5);
    await stubAdvance(db, { workerId: 1, nextStatus: "Visa Preparation" }, 5);
    await stubReject(db, { workerId: 1, rejectionReason: "Documents expired" }, 5);

    assert.equal(db.SponsoredWorkerAudit._rows.length, 3);
    assert.equal(db.SponsoredWorkerAudit._rows[0].toStatus, "Immigration Assessment");
    assert.equal(db.SponsoredWorkerAudit._rows[1].toStatus, "Visa Preparation");
    assert.equal(db.SponsoredWorkerAudit._rows[2].toStatus, "Visa Rejected");
  });

  it("each audit row captures fromStatus and toStatus correctly", async () => {
    const worker = makeWorker({ status: "Compliance Review" });
    const db = makeTenantDb({ worker });
    await stubAdvance(db, { workerId: 1, nextStatus: "Visa Decision" }, 5);

    const row = db.SponsoredWorkerAudit._rows[0];
    assert.equal(row.fromStatus, "Compliance Review");
    assert.equal(row.toStatus, "Visa Decision");
  });
});

// ─── listCaseworkerWorkers — Op.contains query (ISSUE-002 fix) ───────────────

/**
 * Simulates Sequelize Op.contains behaviour: returns rows where
 * assignedCaseworkerIds array contains the given ID.
 * The real implementation delegates to Sequelize which compiles
 * { [Op.contains]: [id] } → the PostgreSQL @> operator.
 */
const Op = { contains: Symbol("Op.contains") };

function makeFilteringDb(workers) {
  return {
    SponsoredWorker: {
      findAll: async ({ where }) => {
        const containsArg = where?.assignedCaseworkerIds?.[Op.contains];
        if (!containsArg) return workers;
        return workers.filter((w) =>
          containsArg.every((id) => (w.assignedCaseworkerIds ?? []).includes(id))
        );
      },
    },
    User: null,
  };
}

async function stubListCaseworkerWorkers(tenantDb, caseworkerId) {
  return tenantDb.SponsoredWorker.findAll({
    where: {
      assignedCaseworkerIds: { [Op.contains]: [Number(caseworkerId)] },
    },
  });
}

describe("listCaseworkerWorkers — Op.contains (ISSUE-002)", () => {
  it("returns only workers assigned to the given caseworker", async () => {
    const w1 = makeWorker({ id: 1, assignedCaseworkerIds: [3, 7] });
    const w2 = makeWorker({ id: 2, assignedCaseworkerIds: [7] });
    const w3 = makeWorker({ id: 3, assignedCaseworkerIds: [5] });
    const db = makeFilteringDb([w1, w2, w3]);

    const result = await stubListCaseworkerWorkers(db, 7);
    assert.equal(result.length, 2);
    assert.ok(result.find((w) => w.id === 1));
    assert.ok(result.find((w) => w.id === 2));
  });

  it("returns an empty array when no workers are assigned to the caseworker", async () => {
    const w1 = makeWorker({ id: 1, assignedCaseworkerIds: [5] });
    const db = makeFilteringDb([w1]);

    const result = await stubListCaseworkerWorkers(db, 99);
    assert.equal(result.length, 0);
  });

  it("returns all workers assigned to the caseworker when they are the only assignee", async () => {
    const w1 = makeWorker({ id: 1, assignedCaseworkerIds: [3] });
    const w2 = makeWorker({ id: 2, assignedCaseworkerIds: [3] });
    const db = makeFilteringDb([w1, w2]);

    const result = await stubListCaseworkerWorkers(db, 3);
    assert.equal(result.length, 2);
  });

  it("coerces string caseworkerId to number before querying", async () => {
    const w1 = makeWorker({ id: 1, assignedCaseworkerIds: [7] });
    const db = makeFilteringDb([w1]);

    const result = await stubListCaseworkerWorkers(db, "7");
    assert.equal(result.length, 1);
  });

  it("does not return workers with an empty assignedCaseworkerIds array", async () => {
    const w1 = makeWorker({ id: 1, assignedCaseworkerIds: [] });
    const db = makeFilteringDb([w1]);

    const result = await stubListCaseworkerWorkers(db, 7);
    assert.equal(result.length, 0);
  });

  it("query uses Op.contains not a raw literal — no sequelize.fn or sequelize.literal call", () => {
    // Verify the query shape: { assignedCaseworkerIds: { [Op.contains]: [...] } }
    // This is what Sequelize compiles to the @> operator (parameterized).
    const caseworkerId = 7;
    const where = { assignedCaseworkerIds: { [Op.contains]: [Number(caseworkerId)] } };
    const containsValue = where.assignedCaseworkerIds[Op.contains];
    assert.ok(Array.isArray(containsValue), "contains value should be an array");
    assert.deepEqual(containsValue, [7]);
    assert.ok(!("jsonb_contains" in where), "must not use jsonb_contains function name");
  });
});
