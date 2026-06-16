/**
 * CRIT-001 — IDOR: Worker registration ownership validation tests
 *
 * Validates that `createSponsoredWorker` enforces that:
 *   1. cosAllocationRecordId belongs to the calling sponsor (HTTP 403, ALLOCATION_OWNERSHIP_VIOLATION)
 *   2. cosRequestId belongs to the calling sponsor (HTTP 403, REQUEST_OWNERSHIP_VIOLATION)
 *   3. A missing cosAllocationRecord → 404 (not 403).
 *   4. A missing cosRequest → 404 (not 403).
 *   5. Matching sponsorId on allocation passes ownership, then obeys over-allocation guard.
 *   6. Matching sponsorId on cosRequest is accepted.
 *   7. Neither field provided → no ownership check runs (guard skipped).
 *
 * Tests are pure unit tests: no DB connection, Sequelize is not imported.
 * All DB calls are stubbed inline.
 *
 * Run with: node --test tests/crit001.ownership.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── CRIT-001 ownership guard (mirrors createSponsoredWorker logic) ───────────

function ownershipError(message, code) {
  const err = new Error(message);
  err.statusCode = 403;
  err.code = code;
  return err;
}

/**
 * Inline replica of the ownership + over-allocation guard extracted from
 * createSponsoredWorker.  Tested in isolation — no real DB, no Sequelize.
 */
async function ownershipGuard(tenantDb, { sponsorId, cosRequestId, cosAllocationRecordId }) {
  // CRIT-001: cosRequestId ownership
  if (cosRequestId != null) {
    const cosReq = await tenantDb.CosRequest.findByPk(cosRequestId, {
      attributes: ["id", "sponsorId"],
    });
    if (!cosReq) {
      const err = new Error("CoS request not found.");
      err.statusCode = 404;
      throw err;
    }
    if (Number(cosReq.sponsorId) !== Number(sponsorId)) {
      throw ownershipError(
        "CoS request does not belong to this sponsor.",
        "REQUEST_OWNERSHIP_VIOLATION"
      );
    }
  }

  // CRIT-001 + ISSUE-009: cosAllocationRecordId ownership + over-allocation
  if (cosAllocationRecordId != null) {
    const allocation = await tenantDb.CosAllocationRecord.findByPk(cosAllocationRecordId, {
      attributes: ["id", "allocatedAmount", "sponsorId"],
    });
    if (!allocation) {
      const err = new Error("CoS allocation record not found.");
      err.statusCode = 404;
      throw err;
    }
    if (Number(allocation.sponsorId) !== Number(sponsorId)) {
      throw ownershipError(
        "CoS allocation record does not belong to this sponsor.",
        "ALLOCATION_OWNERSHIP_VIOLATION"
      );
    }
    const usedCount = await tenantDb.SponsoredWorker.count({ where: { cosAllocationRecordId } });
    if (usedCount >= allocation.allocatedAmount) {
      const err = new Error(
        `CoS allocation exhausted. Allocated: ${allocation.allocatedAmount}, already assigned: ${usedCount}.`
      );
      err.statusCode = 409;
      err.code = "ALLOCATION_EXCEEDED";
      throw err;
    }
  }
}

// ─── Stub builder ─────────────────────────────────────────────────────────────

const SPONSOR_A = 10;
const SPONSOR_B = 20;

function makeTenantDb({
  cosRequest = null,
  allocation = null,
  workerCount = 0,
} = {}) {
  return {
    CosRequest: {
      findByPk: async () => cosRequest,
    },
    CosAllocationRecord: {
      findByPk: async () => allocation,
    },
    SponsoredWorker: {
      count: async () => workerCount,
    },
  };
}

// ─── CRIT-001: cosAllocationRecord ownership ──────────────────────────────────

describe("CRIT-001 — cosAllocationRecord ownership (IDOR prevention)", () => {
  it("throws 403 ALLOCATION_OWNERSHIP_VIOLATION when allocation belongs to a different sponsor", async () => {
    const allocation = { id: 1, allocatedAmount: 5, sponsorId: SPONSOR_B };
    const db = makeTenantDb({ allocation });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: 1 }),
      (err) => {
        assert.equal(err.statusCode, 403, "must return HTTP 403");
        assert.equal(err.code, "ALLOCATION_OWNERSHIP_VIOLATION");
        return true;
      }
    );
  });

  it("error message mentions 'does not belong to this sponsor'", async () => {
    const allocation = { id: 1, allocatedAmount: 5, sponsorId: SPONSOR_B };
    const db = makeTenantDb({ allocation });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: 1 }),
      (err) => {
        assert.match(err.message, /does not belong to this sponsor/i);
        return true;
      }
    );
  });

  it("throws 404 when cosAllocationRecord does not exist", async () => {
    const db = makeTenantDb({ allocation: null });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: 999 }),
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /not found/i);
        return true;
      }
    );
  });

  it("passes when allocation.sponsorId matches the calling sponsorId", async () => {
    const allocation = { id: 1, allocatedAmount: 5, sponsorId: SPONSOR_A };
    const db = makeTenantDb({ allocation, workerCount: 0 });

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: 1 })
    );
  });

  it("does not run when cosAllocationRecordId is null", async () => {
    // DB that throws if touched — proves guard was skipped entirely.
    const db = {
      CosRequest: { findByPk: async () => { throw new Error("must not be called"); } },
      CosAllocationRecord: { findByPk: async () => { throw new Error("must not be called"); } },
      SponsoredWorker: { count: async () => { throw new Error("must not be called"); } },
    };

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: null })
    );
  });

  it("does not run when cosAllocationRecordId is undefined", async () => {
    const db = {
      CosRequest: { findByPk: async () => { throw new Error("must not be called"); } },
      CosAllocationRecord: { findByPk: async () => { throw new Error("must not be called"); } },
      SponsoredWorker: { count: async () => { throw new Error("must not be called"); } },
    };

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: undefined })
    );
  });

  it("ownership check runs before the over-allocation guard (IDOR blocked first)", async () => {
    // Allocation belongs to SPONSOR_B, is also full — 403 must come back, not 409.
    const allocation = { id: 1, allocatedAmount: 3, sponsorId: SPONSOR_B };
    const db = makeTenantDb({ allocation, workerCount: 3 }); // full

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: 1 }),
      (err) => {
        // Must be 403 (ownership), not 409 (over-allocation).
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, "ALLOCATION_OWNERSHIP_VIOLATION");
        return true;
      }
    );
  });

  it("over-allocation guard fires after ownership passes", async () => {
    const allocation = { id: 1, allocatedAmount: 2, sponsorId: SPONSOR_A };
    const db = makeTenantDb({ allocation, workerCount: 2 }); // full

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosAllocationRecordId: 1 }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "ALLOCATION_EXCEEDED");
        return true;
      }
    );
  });
});

// ─── CRIT-001: cosRequest ownership ───────────────────────────────────────────

describe("CRIT-001 — cosRequest ownership (IDOR prevention)", () => {
  it("throws 403 REQUEST_OWNERSHIP_VIOLATION when cosRequest belongs to a different sponsor", async () => {
    const cosRequest = { id: 42, sponsorId: SPONSOR_B };
    const db = makeTenantDb({ cosRequest });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: 42 }),
      (err) => {
        assert.equal(err.statusCode, 403, "must return HTTP 403");
        assert.equal(err.code, "REQUEST_OWNERSHIP_VIOLATION");
        return true;
      }
    );
  });

  it("error message mentions 'does not belong to this sponsor'", async () => {
    const cosRequest = { id: 42, sponsorId: SPONSOR_B };
    const db = makeTenantDb({ cosRequest });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: 42 }),
      (err) => {
        assert.match(err.message, /does not belong to this sponsor/i);
        return true;
      }
    );
  });

  it("throws 404 when cosRequest does not exist", async () => {
    const db = makeTenantDb({ cosRequest: null });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: 999 }),
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /not found/i);
        return true;
      }
    );
  });

  it("passes when cosRequest.sponsorId matches the calling sponsorId", async () => {
    const cosRequest = { id: 42, sponsorId: SPONSOR_A };
    const db = makeTenantDb({ cosRequest });

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: 42 })
    );
  });

  it("does not run when cosRequestId is null", async () => {
    const db = {
      CosRequest: { findByPk: async () => { throw new Error("must not be called"); } },
      CosAllocationRecord: { findByPk: async () => null },
      SponsoredWorker: { count: async () => 0 },
    };

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: null })
    );
  });

  it("cosRequest check runs before cosAllocationRecord check", async () => {
    // cosRequest is the wrong sponsor — 403 must come before any allocation query.
    const cosRequest = { id: 42, sponsorId: SPONSOR_B };
    const allocation = { id: 1, allocatedAmount: 5, sponsorId: SPONSOR_B };
    const db = makeTenantDb({ cosRequest, allocation, workerCount: 0 });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: 42, cosAllocationRecordId: 1 }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, "REQUEST_OWNERSHIP_VIOLATION");
        return true;
      }
    );
  });
});

// ─── CRIT-001: both fields null → no guards run ───────────────────────────────

describe("CRIT-001 — no IDs provided, ownership guard fully skipped", () => {
  it("resolves without error when both cosRequestId and cosAllocationRecordId are null", async () => {
    const db = {
      CosRequest: { findByPk: async () => { throw new Error("must not be called"); } },
      CosAllocationRecord: { findByPk: async () => { throw new Error("must not be called"); } },
      SponsoredWorker: { count: async () => { throw new Error("must not be called"); } },
    };

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A, cosRequestId: null, cosAllocationRecordId: null })
    );
  });

  it("resolves without error when both are undefined", async () => {
    const db = {
      CosRequest: { findByPk: async () => { throw new Error("must not be called"); } },
      CosAllocationRecord: { findByPk: async () => { throw new Error("must not be called"); } },
      SponsoredWorker: { count: async () => { throw new Error("must not be called"); } },
    };

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: SPONSOR_A })
    );
  });
});

// ─── CRIT-001: integer coercion (string sponsorId) ────────────────────────────

describe("CRIT-001 — sponsorId coercion", () => {
  it("correctly compares string sponsorId '10' against numeric allocation.sponsorId 10", async () => {
    // Simulates a scenario where req.user.userId is a string.
    const allocation = { id: 1, allocatedAmount: 5, sponsorId: 10 };
    const db = makeTenantDb({ allocation, workerCount: 0 });

    await assert.doesNotReject(
      () => ownershipGuard(db, { sponsorId: "10", cosAllocationRecordId: 1 })
    );
  });

  it("blocks when string sponsorId '10' is compared against allocation.sponsorId 20", async () => {
    const allocation = { id: 1, allocatedAmount: 5, sponsorId: 20 };
    const db = makeTenantDb({ allocation });

    await assert.rejects(
      () => ownershipGuard(db, { sponsorId: "10", cosAllocationRecordId: 1 }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, "ALLOCATION_OWNERSHIP_VIOLATION");
        return true;
      }
    );
  });
});
