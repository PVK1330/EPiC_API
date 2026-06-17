// Tests: P2-WM-12 — Worker allocation race condition fix.
//
// Verifies that createSponsoredWorker uses a SELECT FOR UPDATE transaction so
// that concurrent creation requests for the same allocation are serialised by
// the DB engine, making over-allocation mathematically impossible.
//
// Test strategy:
//   Unit tests use a mock tenantDb whose transaction() callback executes the
//   callback synchronously (mimicking what the DB does after granting the lock
//   to one caller at a time).  The concurrency simulation test models the
//   serialised execution that FOR UPDATE guarantees: after request A commits,
//   request B re-reads the count and sees A's worker — so B correctly rejects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSponsoredWorker } from "../src/services/sponsoredWorker.service.js";

// ── Mock factory helpers ──────────────────────────────────────────────────────

const ALLOCATION_ID = 99;
const SPONSOR_ID = 1;

function makeAllocation({ allocatedAmount = 5, sponsorId = SPONSOR_ID } = {}) {
  return { id: ALLOCATION_ID, allocatedAmount, sponsorId };
}

/**
 * Build a minimal mock tenantDb.
 *
 * @param {object} opts
 *   usedCount       – workers already assigned to this allocation (default 0)
 *   allocation      – allocation row returned by findByPk
 *   lockCall        – spy array; each { options } entry is pushed when findByPk is called
 *   countCall       – spy array; each { opts } entry is pushed when count is called
 *   createdWorkers  – array to push each successfully created worker row into
 */
function makeTenantDb({
  usedCount = 0,
  allocation = makeAllocation(),
  lockCalls = [],
  countCalls = [],
  createdWorkers = [],
} = {}) {
  let workerIdSeq = 100;

  return {
    sequelize: {
      transaction: async (fn) => {
        // Simulate the DB granting the lock and running the callback.
        const t = {
          LOCK: { UPDATE: "UPDATE" },
        };
        return fn(t);
      },
    },

    CosAllocationRecord: {
      findByPk: async (id, opts) => {
        lockCalls.push({ id, opts });
        return allocation;
      },
    },

    SponsoredWorker: {
      count: async (opts) => {
        countCalls.push(opts);
        return usedCount;
      },
      create: async (data, opts) => {
        const row = { id: ++workerIdSeq, ...data };
        createdWorkers.push(row);
        return row;
      },
    },

    SponsoredWorkerAudit: {
      create: async () => {},
    },

    // Unused in createSponsoredWorker for the allocation path but referenced for
    // the no-allocation path guard.
    CosRequest: {
      findByPk: async () => null,
    },
  };
}

function basePayload(overrides = {}) {
  return {
    sponsorId: SPONSOR_ID,
    organisationId: 10,
    cosAllocationRecordId: ALLOCATION_ID,
    workerFirstName: "Ravi",
    workerLastName: "Kumar",
    workerEmail: null,
    workerNationality: "Indian",
    visaType: "Skilled Worker",
    notes: null,
    ...overrides,
  };
}

// ── Test 1: FOR UPDATE lock is acquired on CosAllocationRecord ────────────────

test("acquires FOR UPDATE lock on CosAllocationRecord inside transaction", async () => {
  const lockCalls = [];
  const db = makeTenantDb({ usedCount: 0, lockCalls });

  await createSponsoredWorker(db, basePayload(), null);

  assert.equal(lockCalls.length, 1, "findByPk called once");
  const opts = lockCalls[0].opts;
  assert.ok(opts?.lock, "lock option must be truthy");
  assert.equal(opts.lock, "UPDATE", "lock must be t.LOCK.UPDATE");
  assert.ok(opts.transaction, "transaction must be passed");
});

// ── Test 2: Count is performed inside the same transaction ───────────────────

test("count query carries the transaction context", async () => {
  const countCalls = [];
  const db = makeTenantDb({ usedCount: 2, countCalls });

  await createSponsoredWorker(db, basePayload(), null);

  assert.equal(countCalls.length, 1, "count called once");
  assert.ok(countCalls[0].transaction, "count must run inside the transaction");
});

// ── Test 3: Worker create carries the transaction context ────────────────────

test("SponsoredWorker.create carries the transaction context", async () => {
  let capturedCreateOpts;
  const db = makeTenantDb({ usedCount: 0 });
  const origCreate = db.SponsoredWorker.create;
  db.SponsoredWorker.create = async (data, opts) => {
    capturedCreateOpts = opts;
    return origCreate(data, opts);
  };

  await createSponsoredWorker(db, basePayload(), null);

  assert.ok(capturedCreateOpts?.transaction, "worker create must run inside the transaction");
});

// ── Test 4: Audit create carries the transaction context ─────────────────────

test("SponsoredWorkerAudit.create carries the transaction context", async () => {
  let capturedAuditOpts;
  const db = makeTenantDb({ usedCount: 0 });
  db.SponsoredWorkerAudit.create = async (data, opts) => {
    capturedAuditOpts = opts;
  };

  await createSponsoredWorker(db, basePayload(), null);

  assert.ok(capturedAuditOpts?.transaction, "audit create must run inside the transaction");
});

// ── Test 5: Last slot available — creation succeeds ──────────────────────────

test("creation succeeds when exactly one slot remains (usedCount = allocatedAmount - 1)", async () => {
  const createdWorkers = [];
  const db = makeTenantDb({ usedCount: 4, allocation: makeAllocation({ allocatedAmount: 5 }), createdWorkers });

  const worker = await createSponsoredWorker(db, basePayload(), null);

  assert.ok(worker?.id, "worker returned");
  assert.equal(createdWorkers.length, 1, "exactly one worker created");
});

// ── Test 6: All slots taken — throws ALLOCATION_EXCEEDED ─────────────────────

test("throws ALLOCATION_EXCEEDED (HTTP 409) when usedCount >= allocatedAmount", async () => {
  const db = makeTenantDb({ usedCount: 5, allocation: makeAllocation({ allocatedAmount: 5 }) });

  await assert.rejects(
    () => createSponsoredWorker(db, basePayload(), null),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "ALLOCATION_EXCEEDED");
      return true;
    },
  );
});

// ── Test 7: Ownership violation — throws ownershipError (HTTP 403) ───────────

test("throws ALLOCATION_OWNERSHIP_VIOLATION when allocation belongs to a different sponsor", async () => {
  const db = makeTenantDb({
    usedCount: 0,
    allocation: makeAllocation({ sponsorId: 999 }), // different sponsor
  });

  await assert.rejects(
    () => createSponsoredWorker(db, basePayload({ sponsorId: 1 }), null),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, "ALLOCATION_OWNERSHIP_VIOLATION");
      return true;
    },
  );
});

// ── Test 8: Allocation not found — throws 404 ────────────────────────────────

test("throws 404 when CosAllocationRecord does not exist", async () => {
  const db = makeTenantDb({ allocation: null });

  await assert.rejects(
    () => createSponsoredWorker(db, basePayload(), null),
    (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

// ── Test 9: Concurrent simulation — only one of two simultaneous requests succeeds
//
// Scenario: allocatedAmount = 5, currently usedCount = 4 (one slot left).
// Request A and Request B are launched simultaneously via Promise.all.
//
// Real DB behaviour with FOR UPDATE:
//   Request A acquires the row lock and runs to commit.
//   Request B blocks at the lock until A commits.
//   When B finally reads the count it sees A's committed worker (count=5) and rejects.
//
// We simulate this serial guarantee with a promise-based mutex:
//   The transaction mock maintains a chain of promises so that each callback
//   awaits the previous one before executing — exactly what the DB lock does.
//   Both requests enter transaction() simultaneously, but only one runs its
//   callback at a time.  By the time the second callback reads the count,
//   the first has already pushed its worker into createdWorkers.

test("concurrent simulation: only one request succeeds when final slot remains", async () => {
  const createdWorkers = [];

  // Mutex: each transaction callback must wait for the previous one to commit.
  // This mirrors the serial execution that SELECT FOR UPDATE provides.
  let lockChain = Promise.resolve();

  const db = {
    sequelize: {
      transaction: async (fn) => {
        const t = { LOCK: { UPDATE: "UPDATE" } };
        // Grab the current tail of the chain, then extend it.
        const waitFor = lockChain;
        let release;
        lockChain = new Promise((resolve) => { release = resolve; });
        // Block until the previous transaction committed.
        await waitFor;
        try {
          return await fn(t);
        } finally {
          // Signal the next waiter that this transaction is done.
          release();
        }
      },
    },

    CosAllocationRecord: {
      findByPk: async () => ({
        id: ALLOCATION_ID,
        allocatedAmount: 5,
        sponsorId: SPONSOR_ID,
      }),
    },

    SponsoredWorker: {
      // Count reflects committed workers — i.e. what is in createdWorkers at
      // the time this callback executes (after the mutex is released by whoever
      // ran before us).
      count: async () => createdWorkers.length + 4,
      create: async (data) => {
        const row = { id: createdWorkers.length + 100, ...data };
        createdWorkers.push(row);
        return row;
      },
    },

    SponsoredWorkerAudit: {
      create: async () => {},
    },

    CosRequest: {
      findByPk: async () => null,
    },
  };

  const payload = basePayload();

  // Launch both requests simultaneously.
  const results = await Promise.allSettled([
    createSponsoredWorker(db, payload, null),
    createSponsoredWorker(db, payload, null),
  ]);

  const succeeded = results.filter((r) => r.status === "fulfilled");
  const rejected  = results.filter((r) => r.status === "rejected");

  assert.equal(succeeded.length, 1, "exactly one request must succeed");
  assert.equal(rejected.length,  1, "exactly one request must be rejected");
  assert.equal(createdWorkers.length, 1, "exactly one worker row created");

  const err = rejected[0].reason;
  assert.equal(err.statusCode, 409,                  "rejected request returns HTTP 409");
  assert.equal(err.code,       "ALLOCATION_EXCEEDED", "rejection code is ALLOCATION_EXCEEDED");
});

// ── Test 10: No-allocation path still works without a transaction ─────────────

test("worker created successfully when no cosAllocationRecordId is provided", async () => {
  const createdWorkers = [];
  // No cosAllocationRecordId → no transaction path needed
  const db = {
    SponsoredWorker: {
      create: async (data) => {
        const row = { id: 200, ...data };
        createdWorkers.push(row);
        return row;
      },
    },
    SponsoredWorkerAudit: {
      create: async () => {},
    },
    CosRequest: {
      findByPk: async () => null,
    },
  };

  const worker = await createSponsoredWorker(db, basePayload({ cosAllocationRecordId: null }), null);

  assert.ok(worker?.id, "worker returned");
  assert.equal(createdWorkers.length, 1, "one worker created");
  assert.equal(worker.cosAllocationRecordId, null, "cosAllocationRecordId is null");
});
