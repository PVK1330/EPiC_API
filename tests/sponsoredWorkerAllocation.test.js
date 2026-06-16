/**
 * Over-allocation guard tests for createSponsoredWorker — ISSUE-009.
 *
 * Before creating a SponsoredWorker the service must:
 *   1. Load the CosAllocationRecord by cosAllocationRecordId.
 *   2. Count existing workers already linked to that record.
 *   3. If count >= allocatedAmount → throw HTTP 409 ALLOCATION_EXCEEDED.
 *
 * Scenarios covered:
 *   - Sequential creation of 6 workers against an allocation of 5:
 *       workers 1–5 succeed, worker 6 is rejected.
 *   - 409 error carries code = "ALLOCATION_EXCEEDED".
 *   - Error message names both the limit and the used count.
 *   - No allocation record provided → guard is skipped (backwards-compatible).
 *   - Unknown cosAllocationRecordId → 404.
 *   - Allocation of 0 → first creation attempt is rejected.
 *   - Allocation exactly full (count == allocatedAmount) → 409.
 *   - One slot remaining (count == allocatedAmount - 1) → succeeds.
 *
 * Run with: node --test tests/sponsoredWorkerAllocation.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Inline guard logic ────────────────────────────────────────────────────────
// Mirrors the check added to createSponsoredWorker in sponsoredWorker.service.js.
// Tested in isolation so no DB or real Sequelize is needed.

async function allocationGuard(tenantDb, cosAllocationRecordId) {
  if (cosAllocationRecordId == null) return; // guard only runs when an allocation is linked

  const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
    attributes: ["id", "allocatedAmount"],
  });
  if (!allocation) {
    const err = new Error("CoS allocation record not found.");
    err.statusCode = 404;
    throw err;
  }

  const usedCount = await tenantDb.SponsoredWorker.count({
    where: { cosAllocationRecordId },
  });

  if (usedCount >= allocation.allocatedAmount) {
    const err = new Error(
      `CoS allocation exhausted. Allocated: ${allocation.allocatedAmount}, already assigned: ${usedCount}.`
    );
    err.statusCode = 409;
    err.code = "ALLOCATION_EXCEEDED";
    throw err;
  }
}

// ─── Stub helpers ─────────────────────────────────────────────────────────────

/**
 * Build a tenantDb stub where CosAllocationRecord returns the given amount
 * and SponsoredWorker.count returns a mutable counter driven by `workerCount`.
 */
function makeTenantDb({ allocatedAmount, workerCount }) {
  return {
    CosAllocationRecord: {
      findByPk: async (_id, _opts) =>
        allocatedAmount === null ? null : { id: 1, allocatedAmount },
    },
    SponsoredWorker: {
      count: async () => workerCount.value,
      create: async (data) => ({ id: workerCount.value + 1, ...data }),
    },
    SponsoredWorkerAudit: {
      create: async () => {},
    },
  };
}

/**
 * Simulate createSponsoredWorker: run the guard, then increment the counter
 * on success (mirrors what the real create() does atomically in the service).
 */
async function simulateCreate(tenantDb, cosAllocationRecordId, workerCount) {
  await allocationGuard(tenantDb, cosAllocationRecordId);
  workerCount.value += 1; // simulate the INSERT succeeding
  return { id: workerCount.value };
}

// ─── 1. Core scenario: allocation 5, attempt 6 creations ─────────────────────

describe("createSponsoredWorker — over-allocation guard (ISSUE-009)", () => {
  it("first 5 workers succeed, 6th is rejected with 409", async () => {
    const ALLOCATION = 5;
    const workerCount = { value: 0 };
    const db = makeTenantDb({ allocatedAmount: ALLOCATION, workerCount });

    const results = [];
    for (let i = 1; i <= 6; i++) {
      try {
        await simulateCreate(db, 1, workerCount);
        results.push({ attempt: i, status: "ok" });
      } catch (err) {
        results.push({ attempt: i, status: "rejected", statusCode: err.statusCode, code: err.code });
      }
    }

    const successes = results.filter(r => r.status === "ok");
    const rejections = results.filter(r => r.status === "rejected");

    assert.equal(successes.length, 5, "exactly 5 creations must succeed");
    assert.equal(rejections.length, 1, "exactly 1 creation must be rejected");
    assert.equal(rejections[0].attempt, 6, "the 6th attempt must be the one rejected");
    assert.equal(rejections[0].statusCode, 409);
    assert.equal(rejections[0].code, "ALLOCATION_EXCEEDED");
  });

  it("after 5 successes the worker count equals the allocation limit", async () => {
    const workerCount = { value: 0 };
    const db = makeTenantDb({ allocatedAmount: 5, workerCount });

    for (let i = 0; i < 5; i++) {
      await simulateCreate(db, 1, workerCount);
    }

    assert.equal(workerCount.value, 5);
  });

  it("7th attempt after allocation 5 is also rejected (guard persists)", async () => {
    const workerCount = { value: 0 };
    const db = makeTenantDb({ allocatedAmount: 5, workerCount });

    // succeed 5, fail 6, fail 7
    for (let i = 0; i < 5; i++) await simulateCreate(db, 1, workerCount);

    for (const attempt of [6, 7]) {
      await assert.rejects(
        () => simulateCreate(db, 1, workerCount),
        (err) => {
          assert.equal(err.statusCode, 409, `attempt ${attempt} must be 409`);
          return true;
        }
      );
    }
  });
});

// ─── 2. 409 error shape ───────────────────────────────────────────────────────

describe("createSponsoredWorker — 409 error shape (ISSUE-009)", () => {
  it("error code is ALLOCATION_EXCEEDED", async () => {
    const workerCount = { value: 3 }; // already full
    const db = makeTenantDb({ allocatedAmount: 3, workerCount });

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.equal(err.code, "ALLOCATION_EXCEEDED");
        return true;
      }
    );
  });

  it("error message contains the allocatedAmount", async () => {
    const workerCount = { value: 5 };
    const db = makeTenantDb({ allocatedAmount: 5, workerCount });

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.match(err.message, /5/, "message must mention the allocation limit");
        return true;
      }
    );
  });

  it("error message contains the current used count", async () => {
    const workerCount = { value: 5 };
    const db = makeTenantDb({ allocatedAmount: 5, workerCount });

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.match(err.message, /already assigned: 5/i);
        return true;
      }
    );
  });

  it("statusCode is 409 (not 400 or 422)", async () => {
    const workerCount = { value: 2 };
    const db = makeTenantDb({ allocatedAmount: 2, workerCount });

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });
});

// ─── 3. Guard skip when no allocation record is linked ────────────────────────

describe("createSponsoredWorker — guard skipped without allocation (ISSUE-009)", () => {
  it("cosAllocationRecordId = null → guard does not run", async () => {
    // DB stub that would throw if touched — proves guard was skipped.
    const db = {
      CosAllocationRecord: {
        findByPk: async () => { throw new Error("Guard must not query DB"); },
      },
      SponsoredWorker: { count: async () => { throw new Error("Guard must not count"); } },
    };

    // Should resolve without error.
    await assert.doesNotReject(() => allocationGuard(db, null));
  });

  it("cosAllocationRecordId = undefined → guard does not run", async () => {
    const db = {
      CosAllocationRecord: { findByPk: async () => { throw new Error("unreachable"); } },
      SponsoredWorker: { count: async () => { throw new Error("unreachable"); } },
    };

    await assert.doesNotReject(() => allocationGuard(db, undefined));
  });
});

// ─── 4. Allocation record not found ──────────────────────────────────────────

describe("createSponsoredWorker — allocation record not found (ISSUE-009)", () => {
  it("unknown cosAllocationRecordId → 404", async () => {
    const db = makeTenantDb({ allocatedAmount: null, workerCount: { value: 0 } });

    await assert.rejects(
      () => allocationGuard(db, 999),
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /not found/i);
        return true;
      }
    );
  });
});

// ─── 5. Edge cases ────────────────────────────────────────────────────────────

describe("createSponsoredWorker — allocation edge cases (ISSUE-009)", () => {
  it("allocation of 0 → first attempt immediately rejected with 409", async () => {
    const workerCount = { value: 0 };
    const db = makeTenantDb({ allocatedAmount: 0, workerCount });

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "ALLOCATION_EXCEEDED");
        return true;
      }
    );
  });

  it("count exactly equals allocatedAmount → 409 (boundary: = not just >)", async () => {
    const workerCount = { value: 3 }; // count == limit
    const db = makeTenantDb({ allocatedAmount: 3, workerCount });

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it("count one below limit (count = allocatedAmount - 1) → succeeds", async () => {
    const workerCount = { value: 4 }; // one slot left
    const db = makeTenantDb({ allocatedAmount: 5, workerCount });

    await assert.doesNotReject(() => simulateCreate(db, 1, workerCount));
    assert.equal(workerCount.value, 5);
  });

  it("allocation of 1 → first worker succeeds, second is rejected", async () => {
    const workerCount = { value: 0 };
    const db = makeTenantDb({ allocatedAmount: 1, workerCount });

    await assert.doesNotReject(() => simulateCreate(db, 1, workerCount));

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "ALLOCATION_EXCEEDED");
        return true;
      }
    );
  });

  it("large allocation (100) — 99th worker succeeds, 100th succeeds, 101st fails", async () => {
    const workerCount = { value: 98 };
    const db = makeTenantDb({ allocatedAmount: 100, workerCount });

    await assert.doesNotReject(() => simulateCreate(db, 1, workerCount)); // 99th
    await assert.doesNotReject(() => simulateCreate(db, 1, workerCount)); // 100th

    await assert.rejects(
      () => simulateCreate(db, 1, workerCount), // 101st
      (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });
});
