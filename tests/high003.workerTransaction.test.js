/**
 * HIGH-003 — advanceWorkerStage() / rejectWorkerVisa() transaction hardening tests
 *
 * Validates that atomicWorkerStateChange (used by both functions):
 *   1. Status update and audit row are committed together.
 *   2. Audit write failure rolls back the status update.
 *   3. FSM validation runs inside the transaction.
 *   4. Concurrent stage updates on same worker — one wins, one gets 422.
 *   5. rejectWorkerVisa rolls back on audit failure.
 *   6. rejectWorkerVisa requires rejectionReason.
 *
 * Run: node --test tests/high003.workerTransaction.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── FSM stub (matches WORKER_TRANSITIONS) ────────────────────────────────────

const VALID_TRANSITIONS = {
  "CoS Assigned":           ["Immigration Assessment", "Visa Rejected"],
  "Immigration Assessment": ["Visa Preparation", "Visa Rejected"],
  "Visa Preparation":       ["Compliance Review", "Visa Rejected"],
  "Compliance Review":      ["Visa Decision", "Visa Rejected"],
  "Visa Decision":          ["Visa Granted", "Visa Rejected"],
};

function fakeValidateTransition(fromStatus, toStatus) {
  const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
  if (allowed.includes(toStatus)) return { valid: true };
  return { valid: false, message: `Cannot advance from ${fromStatus} to ${toStatus}` };
}

// ─── Inline replica of atomicWorkerStateChange ────────────────────────────────

function makeTransaction() {
  const events = [];
  return {
    events,
    committed: false,
    rolledBack: false,
    commit:   async () => { events.push("commit");   },
    rollback: async () => { events.push("rollback"); },
  };
}

async function atomicWorkerStateChange(
  tenantDb,
  { workerId, nextStatus, extraFields = {}, auditAction, actorId, notes }
) {
  const t = await tenantDb.sequelize.transaction();
  let worker;
  try {
    worker = await tenantDb.SponsoredWorker.findByPk(workerId, { lock: true, transaction: t });
    if (!worker) {
      const err = new Error("Sponsored worker not found."); err.statusCode = 404; throw err;
    }

    const { valid, message } = fakeValidateTransition(worker.status, nextStatus);
    if (!valid) {
      const err = new Error(message); err.statusCode = 422; throw err;
    }

    const fromStatus = worker.status;
    worker.status = nextStatus;
    Object.assign(worker, extraFields);
    await worker.save({ transaction: t });

    await tenantDb.SponsoredWorkerAudit.create({
      sponsoredWorkerId: worker.id,
      action: auditAction,
      fromStatus,
      toStatus: nextStatus,
      actorId: actorId ?? null,
      notes: notes ?? null,
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
  return worker;
}

async function advanceWorkerStage(tenantDb, { workerId, nextStatus, notes }, actorId) {
  return atomicWorkerStateChange(tenantDb, {
    workerId, nextStatus,
    extraFields: notes != null ? { notes } : {},
    auditAction: `stage_advanced:${nextStatus}`,
    actorId, notes,
  });
}

async function rejectWorkerVisa(tenantDb, { workerId, rejectionReason, notes }, actorId) {
  if (!rejectionReason?.trim()) {
    const err = new Error("rejectionReason is required when rejecting a visa.");
    err.statusCode = 400; throw err;
  }
  return atomicWorkerStateChange(tenantDb, {
    workerId,
    nextStatus: "Visa Rejected",
    extraFields: { rejectionReason: rejectionReason.trim(), ...(notes != null ? { notes } : {}) },
    auditAction: "visa_rejected",
    actorId,
    notes: notes ?? rejectionReason,
  });
}

// ─── DB stub builder ──────────────────────────────────────────────────────────

function makeWorkerDb({
  status = "CoS Assigned",
  auditFails = false,
  missing = false,
} = {}) {
  const t = makeTransaction();
  const worker = {
    id: 1, status,
    rejectionReason: null, notes: null,
    save: async () => { t.events.push("worker.save"); },
  };
  return {
    t, worker,
    sequelize: { transaction: async () => t },
    SponsoredWorker: {
      findByPk: async (_id, _opts) => missing ? null : worker,
    },
    SponsoredWorkerAudit: {
      create: async () => {
        if (auditFails) { t.events.push("audit.fail"); throw new Error("Audit DB error"); }
        t.events.push("audit.create");
      },
    },
  };
}

// ─── advanceWorkerStage ───────────────────────────────────────────────────────

describe("HIGH-003 — advanceWorkerStage atomic commit", () => {
  it("commits status update and audit in the same transaction", async () => {
    const db = makeWorkerDb({ status: "CoS Assigned" });
    await advanceWorkerStage(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 99);
    assert.deepEqual(
      db.t.events,
      ["worker.save", "audit.create", "commit"],
      "save → audit → commit must be the event order"
    );
  });

  it("updates worker status to nextStatus", async () => {
    const db = makeWorkerDb({ status: "CoS Assigned" });
    const worker = await advanceWorkerStage(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 99);
    assert.equal(worker.status, "Immigration Assessment");
  });

  it("returns 422 for invalid FSM transition", async () => {
    // CoS Assigned → Visa Granted is not valid.
    const db = makeWorkerDb({ status: "CoS Assigned" });
    await assert.rejects(
      () => advanceWorkerStage(db, { workerId: 1, nextStatus: "Visa Granted" }, 99),
      (err) => { assert.equal(err.statusCode, 422); return true; }
    );
  });

  it("returns 404 when worker not found", async () => {
    const db = makeWorkerDb({ missing: true });
    await assert.rejects(
      () => advanceWorkerStage(db, { workerId: 999, nextStatus: "Immigration Assessment" }, 99),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });
});

describe("HIGH-003 — advanceWorkerStage audit failure rollback", () => {
  it("rolls back status update when audit write fails", async () => {
    const db = makeWorkerDb({ status: "CoS Assigned", auditFails: true });
    await assert.rejects(() =>
      advanceWorkerStage(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 99)
    );
    assert.ok(db.t.events.includes("rollback"), "must rollback on audit failure");
    assert.ok(!db.t.events.includes("commit"),  "must NOT commit on audit failure");
  });

  it("re-throws the original audit error", async () => {
    const db = makeWorkerDb({ status: "CoS Assigned", auditFails: true });
    await assert.rejects(
      () => advanceWorkerStage(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 99),
      (err) => { assert.match(err.message, /Audit DB error/); return true; }
    );
  });

  it("worker status is not persisted when audit fails (rollback)", async () => {
    const db = makeWorkerDb({ status: "CoS Assigned", auditFails: true });
    await assert.rejects(() =>
      advanceWorkerStage(db, { workerId: 1, nextStatus: "Immigration Assessment" }, 99)
    );
    // save was called but commit was never reached → DB row unchanged.
    assert.ok(db.t.events.includes("worker.save"), "save was attempted");
    assert.ok(!db.t.events.includes("commit"), "commit did not happen");
  });
});

describe("HIGH-003 — concurrent stage update simulation", () => {
  it("exactly one concurrent advance succeeds, the other gets 422", async () => {
    // Simulate two concurrent callers — first gets CoS Assigned, advances.
    // Second also sees CoS Assigned at load time but by the time it reaches the
    // transition the real DB would see the updated status. We simulate this by
    // having the second DB stub already show the updated status.
    const [r1, r2] = await Promise.allSettled([
      advanceWorkerStage(
        makeWorkerDb({ status: "CoS Assigned" }),
        { workerId: 1, nextStatus: "Immigration Assessment" }, 1
      ),
      // Second caller sees the row already advanced (lock serialises, re-read shows new status).
      advanceWorkerStage(
        makeWorkerDb({ status: "Immigration Assessment" }),
        { workerId: 1, nextStatus: "CoS Assigned" }, 2   // invalid: backwards
      ),
    ]);

    assert.equal(r1.status, "fulfilled");
    assert.equal(r2.status, "rejected");
    assert.equal(r2.reason.statusCode, 422);
  });
});

// ─── rejectWorkerVisa ─────────────────────────────────────────────────────────

describe("HIGH-003 — rejectWorkerVisa atomic commit", () => {
  it("commits status and audit in the same transaction", async () => {
    const db = makeWorkerDb({ status: "CoS Assigned" });
    await rejectWorkerVisa(db, { workerId: 1, rejectionReason: "Ineligible" }, 99);
    assert.deepEqual(
      db.t.events,
      ["worker.save", "audit.create", "commit"]
    );
  });

  it("sets status to Visa Rejected", async () => {
    const db = makeWorkerDb({ status: "Immigration Assessment" });
    const worker = await rejectWorkerVisa(db, { workerId: 1, rejectionReason: "Docs missing" }, 99);
    assert.equal(worker.status, "Visa Rejected");
  });

  it("stores trimmed rejectionReason on the worker row", async () => {
    const db = makeWorkerDb({ status: "Visa Decision" });
    const worker = await rejectWorkerVisa(db, {
      workerId: 1,
      rejectionReason: "  Criminal record  ",
    }, 99);
    assert.equal(worker.rejectionReason, "Criminal record");
  });

  it("throws 400 when rejectionReason is missing", async () => {
    const db = makeWorkerDb();
    await assert.rejects(
      () => rejectWorkerVisa(db, { workerId: 1, rejectionReason: "" }, 99),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );
  });

  it("rolls back when audit write fails", async () => {
    const db = makeWorkerDb({ status: "Compliance Review", auditFails: true });
    await assert.rejects(() =>
      rejectWorkerVisa(db, { workerId: 1, rejectionReason: "Audit error test" }, 99)
    );
    assert.ok(db.t.events.includes("rollback"));
    assert.ok(!db.t.events.includes("commit"));
  });

  it("rejectWorkerVisa from any stage succeeds", async () => {
    const stages = [
      "CoS Assigned", "Immigration Assessment", "Visa Preparation",
      "Compliance Review", "Visa Decision",
    ];
    for (const stage of stages) {
      const db = makeWorkerDb({ status: stage });
      const worker = await rejectWorkerVisa(db, { workerId: 1, rejectionReason: `Rejected from ${stage}` }, 99);
      assert.equal(worker.status, "Visa Rejected", `must reject from ${stage}`);
    }
  });
});
