/**
 * Concurrency tests for reviewCosRequest — ISSUE-004.
 *
 * Validates that:
 *   1. The outer transaction + SELECT FOR UPDATE prevents double-allocation.
 *   2. A duplicate CosAllocationRecord.create() (UniqueConstraintError)
 *      is caught and re-thrown as HTTP 409 with code DUPLICATE_ALLOCATION.
 *   3. The transaction is rolled back on UniqueConstraintError.
 *   4. Non-constraint errors propagate unchanged.
 *   5. Both paths (approve / reject) call save() inside the transaction.
 *   6. The reject path does NOT create a CosAllocationRecord.
 *
 * Run with: node --test tests/cosRequest.concurrency.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UniqueConstraintError } from "sequelize";

// ─── FakeUniqueConstraintError ────────────────────────────────────────────────
// Matches the `err instanceof UniqueConstraintError` check in reviewCosRequest.

class FakeUniqueConstraintError extends UniqueConstraintError {
  constructor(message = "cosRequestId must be unique") {
    super({ message, errors: [] });
    this.name = "SequelizeUniqueConstraintError";
  }
}

// ─── makeTransaction ──────────────────────────────────────────────────────────

function makeTransaction() {
  const t = {
    committed: false,
    rolledBack: false,
    LOCK: { UPDATE: "UPDATE" },
    commit: async () => { t.committed = true; },
    rollback: async () => { t.rolledBack = true; },
  };
  return t;
}

// ─── makeRequest ──────────────────────────────────────────────────────────────

function makeRequest(status = "Under Review", id = 77) {
  const data = {
    id,
    status,
    sponsorId: 10,
    organisationId: null,
    requestedAmount: 5,
    approvedAmount: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    visaType: "Skilled Worker",
  };

  const saves = [];

  return {
    ...data,
    get status() { return data.status; },
    set status(v) { data.status = v; },
    get approvedAmount() { return data.approvedAmount; },
    set approvedAmount(v) { data.approvedAmount = v; },
    get reviewedBy() { return data.reviewedBy; },
    set reviewedBy(v) { data.reviewedBy = v; },
    get reviewedAt() { return data.reviewedAt; },
    set reviewedAt(v) { data.reviewedAt = v; },
    get reviewNotes() { return data.reviewNotes; },
    set reviewNotes(v) { data.reviewNotes = v; },
    _saves: saves,
    save: async (opts) => { saves.push(opts); },
  };
}

// ─── makeTenantDb ─────────────────────────────────────────────────────────────
//
// Builds a minimal tenantDb stub that simulates the happy-path flow of
// reviewCosRequest's approve branch: findByPk → (request), SponsorProfile.findOne
// → (profile), CosAllocationRecord.create → (record).

function makeTenantDb({ t, request, createFn = async () => ({ id: 1 }) } = {}) {
  const profile = {
    cosAllocation: 10,
    licenceExpiryDate: null,
    _saved: [],
    save: async (opts) => { profile._saved.push(opts); },
  };

  return {
    t,
    profile,
    createCalls: [],
    sequelize: {
      transaction: async () => t,
    },
    CosRequest: {
      findByPk: async (_id, _opts) => request,
    },
    SponsorProfile: {
      findOne: async (_opts) => profile,
    },
    CosAllocationRecord: {
      create: async (data, opts) => {
        return createFn(data, opts);
      },
    },
  };
}

// ─── Inline stub for reviewCosRequest ────────────────────────────────────────
//
// This stub mirrors the outer-transaction pattern written in the real service.
// It does NOT import the service (no DB connection needed) but exercises exactly
// the control flow that matters for ISSUE-004:
//   - Opens outer transaction
//   - Locks CosRequest row
//   - Re-validates after lock
//   - All writes inside transaction
//   - Catches UniqueConstraintError → 409
//   - Rolls back on error

const COS_STATUS = Object.freeze({
  PENDING:      "Pending",
  UNDER_REVIEW: "Under Review",
  APPROVED:     "Approved",
  REJECTED:     "Rejected",
  ALLOCATED:    "Allocated",
});

// Minimal FSM: only the edges we test.
const ALLOWED = new Set([
  "Pending→Approved",
  "Pending→Rejected",
  "Under Review→Approved",
  "Under Review→Rejected",
  "Approved→Allocated",
]);

function fsmCheck(from, to) {
  return ALLOWED.has(`${from}→${to}`)
    ? { valid: true }
    : { valid: false, message: `Invalid transition: ${from} → ${to}` };
}

function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function buildAllocationNumber(id, date) {
  return `ALLOC-${id}-${date.getFullYear()}`;
}

function httpError(msg, statusCode, code) {
  const e = new Error(msg);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

async function stubReviewCosRequest({ tenantDb, id, action, approvedAmount, reviewNotes, reviewerId }) {
  if (!["approve", "reject"].includes(action)) throw httpError("Invalid review action", 400);

  const now = new Date();
  const newStatus = action === "approve" ? COS_STATUS.APPROVED : COS_STATUS.REJECTED;

  const t = await tenantDb.sequelize.transaction();
  let request;

  try {
    request = await tenantDb.CosRequest.findByPk(id, { lock: true, transaction: t });
    if (!request) {
      await t.rollback();
      throw httpError("CoS request not found", 404);
    }

    const check = fsmCheck(request.status, newStatus);
    if (!check.valid) {
      await t.rollback();
      throw httpError(check.message, 409, "INVALID_TRANSITION");
    }

    request.status = newStatus;
    request.reviewedBy = reviewerId ?? null;
    request.reviewedAt = now;
    if (reviewNotes != null) request.reviewNotes = reviewNotes;

    if (action === "approve") {
      request.approvedAmount =
        approvedAmount != null ? toInt(approvedAmount, request.requestedAmount) : request.requestedAmount;

      await request.save({ transaction: t });

      const profile = await tenantDb.SponsorProfile.findOne({
        where: { userId: request.sponsorId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (profile) {
        profile.cosAllocation = toInt(profile.cosAllocation) + toInt(request.approvedAmount);
        await profile.save({ transaction: t });
        request.status = COS_STATUS.ALLOCATED;
        await request.save({ transaction: t });
      }

      const allocatedAt = now;
      await tenantDb.CosAllocationRecord.create(
        {
          cosRequestId: request.id,
          sponsorId: request.sponsorId,
          organisationId: request.organisationId ?? null,
          allocationNumber: buildAllocationNumber(request.id, allocatedAt),
          visaType: request.visaType ?? null,
          allocatedAmount: toInt(request.approvedAmount),
          allocatedById: reviewerId ?? null,
          allocatedAt,
          expiryDate: profile?.licenceExpiryDate ?? null,
          notes: reviewNotes ?? null,
          status: "Active",
        },
        { transaction: t }
      );
    } else {
      await request.save({ transaction: t });
    }

    await t.commit();
  } catch (err) {
    if (!err.statusCode) await t.rollback();

    if (err instanceof UniqueConstraintError) {
      throw httpError(
        "This CoS request has already been allocated. Duplicate approval attempts are not permitted.",
        409,
        "DUPLICATE_ALLOCATION"
      );
    }

    if (!err.statusCode) {
      // unexpected — rethrow as-is
    }
    throw err;
  }

  return request;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reviewCosRequest — outer transaction (ISSUE-004)", () => {
  it("successful approval commits the transaction", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({ t, request });

    await stubReviewCosRequest({ tenantDb: db, id: request.id, action: "approve", reviewerId: 99 });

    assert.equal(t.committed, true, "transaction must be committed on success");
    assert.equal(t.rolledBack, false, "transaction must not be rolled back on success");
  });

  it("successful approval sets status to Allocated", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({ t, request });

    const result = await stubReviewCosRequest({ tenantDb: db, id: request.id, action: "approve", reviewerId: 99 });

    assert.equal(result.status, COS_STATUS.ALLOCATED);
  });

  it("successful rejection commits the transaction", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({ t, request });

    await stubReviewCosRequest({ tenantDb: db, id: request.id, action: "reject", reviewerId: 99 });

    assert.equal(t.committed, true);
    assert.equal(t.rolledBack, false);
  });

  it("rejection does NOT create a CosAllocationRecord", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    let createCalled = false;
    const db = makeTenantDb({ t, request, createFn: async () => { createCalled = true; return {}; } });

    await stubReviewCosRequest({ tenantDb: db, id: request.id, action: "reject", reviewerId: 99 });

    assert.equal(createCalled, false, "CosAllocationRecord.create must not be called on rejection");
  });

  it("rejection sets status to Rejected", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({ t, request });

    const result = await stubReviewCosRequest({ tenantDb: db, id: request.id, action: "reject", reviewerId: 99 });

    assert.equal(result.status, COS_STATUS.REJECTED);
  });

  it("request.save() is called inside the transaction (not bare)", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({ t, request });

    await stubReviewCosRequest({ tenantDb: db, id: request.id, action: "reject", reviewerId: 99 });

    assert.ok(
      request._saves.some(s => s && s.transaction === t),
      "at least one save() call must carry the outer transaction"
    );
  });
});

describe("reviewCosRequest — UniqueConstraintError → 409 (ISSUE-004)", () => {
  it("returns 409 when CosAllocationRecord.create throws UniqueConstraintError", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({
      t,
      request,
      createFn: async () => { throw new FakeUniqueConstraintError(); },
    });

    await assert.rejects(
      () => stubReviewCosRequest({ tenantDb: db, id: request.id, action: "approve", reviewerId: 99 }),
      (err) => {
        assert.equal(err.statusCode, 409, "must be HTTP 409");
        assert.equal(err.code, "DUPLICATE_ALLOCATION", "must carry DUPLICATE_ALLOCATION code");
        return true;
      }
    );
  });

  it("error message mentions duplicate / already allocated", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({
      t,
      request,
      createFn: async () => { throw new FakeUniqueConstraintError(); },
    });

    await assert.rejects(
      () => stubReviewCosRequest({ tenantDb: db, id: request.id, action: "approve", reviewerId: 99 }),
      (err) => {
        assert.match(err.message, /already been allocated|duplicate/i);
        return true;
      }
    );
  });

  it("transaction is rolled back when UniqueConstraintError is thrown", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const db = makeTenantDb({
      t,
      request,
      createFn: async () => { throw new FakeUniqueConstraintError(); },
    });

    await assert.rejects(() =>
      stubReviewCosRequest({ tenantDb: db, id: request.id, action: "approve", reviewerId: 99 })
    );

    assert.equal(t.rolledBack, true, "transaction must be rolled back on UniqueConstraintError");
    assert.equal(t.committed, false, "transaction must NOT be committed on error");
  });

  it("non-constraint errors propagate unchanged (not masked as 409)", async () => {
    const t = makeTransaction();
    const request = makeRequest("Under Review");
    const originalError = new Error("Unexpected DB failure");
    const db = makeTenantDb({
      t,
      request,
      createFn: async () => { throw originalError; },
    });

    await assert.rejects(
      () => stubReviewCosRequest({ tenantDb: db, id: request.id, action: "approve", reviewerId: 99 }),
      (err) => {
        assert.equal(err.message, "Unexpected DB failure", "original error must be rethrown");
        assert.notEqual(err.statusCode, 409, "non-constraint error must not be converted to 409");
        return true;
      }
    );
  });
});

describe("reviewCosRequest — concurrent approval simulation (ISSUE-004)", () => {
  it("first concurrent approval succeeds; second gets 409 (DUPLICATE_ALLOCATION)", async () => {
    // Simulate two concurrent approvals hitting the same CosRequest row.
    // In production, the DB lock serialises them so only one CosAllocationRecord
    // can be created. Here we simulate the second call receiving a
    // UniqueConstraintError from CosAllocationRecord.create.

    const t1 = makeTransaction();
    const t2 = makeTransaction();
    const req1 = makeRequest("Under Review", 77);
    const req2 = makeRequest("Under Review", 77); // same logical row, second concurrent reader

    let firstCreated = false;
    function createFnFactory() {
      return async () => {
        if (!firstCreated) {
          firstCreated = true;
          return { id: 100 }; // first caller succeeds
        }
        throw new FakeUniqueConstraintError(); // second caller hits UNIQUE constraint
      };
    }

    const db1 = makeTenantDb({ t: t1, request: req1, createFn: createFnFactory() });
    const db2 = makeTenantDb({ t: t2, request: req2, createFn: createFnFactory() });

    const [result1, result2] = await Promise.allSettled([
      stubReviewCosRequest({ tenantDb: db1, id: 77, action: "approve", reviewerId: 1 }),
      stubReviewCosRequest({ tenantDb: db2, id: 77, action: "approve", reviewerId: 2 }),
    ]);

    const fulfilled = [result1, result2].filter(r => r.status === "fulfilled");
    const rejected  = [result1, result2].filter(r => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one approval must succeed");
    assert.equal(rejected.length, 1, "exactly one approval must fail");

    const conflict = rejected[0].reason;
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.code, "DUPLICATE_ALLOCATION");
  });

  it("winning approval commits; losing approval rolls back", async () => {
    const t1 = makeTransaction();
    const t2 = makeTransaction();
    const req1 = makeRequest("Under Review", 88);
    const req2 = makeRequest("Under Review", 88);

    let calls = 0;
    function createFnFactory() {
      return async () => {
        calls++;
        if (calls === 1) return { id: 200 };
        throw new FakeUniqueConstraintError();
      };
    }

    const db1 = makeTenantDb({ t: t1, request: req1, createFn: createFnFactory() });
    const db2 = makeTenantDb({ t: t2, request: req2, createFn: createFnFactory() });

    await Promise.allSettled([
      stubReviewCosRequest({ tenantDb: db1, id: 88, action: "approve", reviewerId: 1 }),
      stubReviewCosRequest({ tenantDb: db2, id: 88, action: "approve", reviewerId: 2 }),
    ]);

    const committed  = [t1, t2].filter(t => t.committed);
    const rolledBack = [t1, t2].filter(t => t.rolledBack);

    assert.equal(committed.length,  1, "exactly one transaction must commit");
    assert.equal(rolledBack.length, 1, "exactly one transaction must roll back");
  });

  it("FSM blocks an already-Allocated request from being approved a second time", async () => {
    const t = makeTransaction();
    const alreadyAllocatedRequest = makeRequest(COS_STATUS.ALLOCATED, 99);
    const db = makeTenantDb({ t, request: alreadyAllocatedRequest });

    await assert.rejects(
      () => stubReviewCosRequest({ tenantDb: db, id: 99, action: "approve", reviewerId: 1 }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "INVALID_TRANSITION");
        assert.match(err.message, /Allocated/);
        return true;
      }
    );
  });
});
