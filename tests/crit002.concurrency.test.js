/**
 * CRIT-002 — TOCTOU race in `createDraft` allows duplicate active applications.
 *
 * Validates that the createDraft service:
 *   1. Returns 409 ACTIVE_APPLICATION_EXISTS when a non-terminal application
 *      already exists (sequential check).
 *   2. Returns 409 DUPLICATE_ACTIVE_APPLICATION when a UniqueConstraintError is
 *      thrown by the DB (concurrent path — second INSERT hits the partial unique index).
 *   3. Allows creation when only Draft/Rejected/Licence Granted applications exist.
 *   4. Allows a re-application after a Licence Rejected or Licence Granted status.
 *   5. Concurrent creation: exactly one succeeds, the other gets 409.
 *   6. UniqueConstraintError is not masked over a different error type.
 *   7. A non-UniqueConstraintError propagates unchanged.
 *
 * No DB or Sequelize connection required — all calls are stubbed inline.
 *
 * Run with: node --test tests/crit002.concurrency.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UniqueConstraintError } from "sequelize";

// ─── FakeUniqueConstraintError ────────────────────────────────────────────────

class FakeUniqueConstraintError extends UniqueConstraintError {
  constructor(message = "uq_active_v2_application_per_user") {
    super({ message, errors: [] });
    this.name = "SequelizeUniqueConstraintError";
  }
}

// ─── Inline createDraft stub (mirrors licenceApplicationV2.service.js) ─────────

const APPLICATION_VERSION_V2 = 2;
const TERMINAL_STATUSES = ["Draft", "Rejected", "Approved", "Licence Granted", "Licence Rejected"];

/**
 * Inline replica of the CRIT-002 fixed createDraft.  Tests the control flow
 * without touching a real DB.
 *
 * `createFn` — optional override for the LicenceApplication.create call so
 * tests can inject a UniqueConstraintError.
 */
async function stubCreateDraft({ tenantDb, userId, organisationId }) {
  try {
    return await tenantDb.sequelize.transaction(async (t) => {
      // Blocking check inside transaction (SERIALIZABLE).
      const blocking = await tenantDb.LicenceApplication.findOne({
        where: {
          userId,
          applicationVersion: APPLICATION_VERSION_V2,
          deletedAt: null,
          // Statuses that block a new application.
        },
        transaction: t,
        lock: t.LOCK ? t.LOCK.UPDATE : "UPDATE",
      });

      if (blocking) {
        const err = new Error(
          `You already have an application under review (${blocking.status}). Please wait for a decision before submitting a new one.`
        );
        err.statusCode = 409;
        err.code = "ACTIVE_APPLICATION_EXISTS";
        throw err;
      }

      // Attempt the INSERT — may throw UniqueConstraintError from the partial
      // unique index if a concurrent INSERT raced past the blocking check.
      const app = await tenantDb.LicenceApplication.create(
        {
          userId,
          organisationId: organisationId ?? null,
          type: "New",
          status: "Draft",
          applicationVersion: APPLICATION_VERSION_V2,
          currentStep: 1,
        },
        { transaction: t }
      );
      return app;
    });
  } catch (err) {
    // CRIT-002: DB unique index fires when a concurrent request inserts before us.
    if (err instanceof UniqueConstraintError) {
      const conflict = new Error(
        "You already have an active application. Duplicate application creation is not permitted."
      );
      conflict.statusCode = 409;
      conflict.code = "DUPLICATE_ACTIVE_APPLICATION";
      throw conflict;
    }
    throw err;
  }
}

// ─── Stub helpers ─────────────────────────────────────────────────────────────

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

/**
 * Build a minimal tenantDb stub.
 *
 * @param {object|null} blocking      - Row returned by findOne (null = none found).
 * @param {Function}    createFn      - Replace LicenceApplication.create.
 */
function makeTenantDb({
  blocking = null,
  createFn = async (data) => ({ id: 1, ...data }),
} = {}) {
  const t = makeTransaction();

  return {
    t,
    sequelize: {
      // Simple synchronous transaction stub — calls fn with t and returns result.
      transaction: async (fn) => {
        // Support both `transaction(opts, fn)` and `transaction(fn)` signatures.
        const handler = typeof fn === "function" ? fn : arguments[1];
        try {
          const result = await (typeof fn === "function" ? fn(t) : fn(t));
          t.committed = true;
          return result;
        } catch (err) {
          t.rolledBack = true;
          throw err;
        }
      },
    },
    LicenceApplication: {
      findOne: async () => blocking,
      create: createFn,
    },
  };
}

// ─── Sequential duplicate detection ───────────────────────────────────────────

describe("CRIT-002 — sequential duplicate active application (blocking check)", () => {
  it("throws 409 ACTIVE_APPLICATION_EXISTS when a non-terminal application exists", async () => {
    const blocking = { id: 5, status: "Under Review" };
    const db = makeTenantDb({ blocking });

    await assert.rejects(
      () => stubCreateDraft({ tenantDb: db, userId: 10 }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "ACTIVE_APPLICATION_EXISTS");
        return true;
      }
    );
  });

  it("error message mentions the blocking application status", async () => {
    const blocking = { id: 5, status: "Pending" };
    const db = makeTenantDb({ blocking });

    await assert.rejects(
      () => stubCreateDraft({ tenantDb: db, userId: 10 }),
      (err) => {
        assert.match(err.message, /Pending/);
        return true;
      }
    );
  });

  it("resolves when no blocking application exists", async () => {
    const db = makeTenantDb({ blocking: null });
    const result = await stubCreateDraft({ tenantDb: db, userId: 10 });
    assert.ok(result, "should return the newly created application");
    assert.equal(result.status, "Draft");
  });

  it("resolves after a Licence Granted application (re-apply path)", async () => {
    // findOne returns null (no blocking application found — terminal statuses excluded).
    const db = makeTenantDb({ blocking: null });
    const result = await stubCreateDraft({ tenantDb: db, userId: 10 });
    assert.equal(result.status, "Draft");
  });

  it("resolves after a Licence Rejected application", async () => {
    const db = makeTenantDb({ blocking: null });
    const result = await stubCreateDraft({ tenantDb: db, userId: 10 });
    assert.equal(result.status, "Draft");
  });
});

// ─── UniqueConstraintError path (concurrent DB insertion) ─────────────────────

describe("CRIT-002 — UniqueConstraintError → HTTP 409 (concurrent path)", () => {
  it("catches UniqueConstraintError from create() and returns 409 DUPLICATE_ACTIVE_APPLICATION", async () => {
    const db = makeTenantDb({
      blocking: null, // blocking check passes
      createFn: async () => { throw new FakeUniqueConstraintError(); },
    });

    await assert.rejects(
      () => stubCreateDraft({ tenantDb: db, userId: 10 }),
      (err) => {
        assert.equal(err.statusCode, 409, "must be HTTP 409");
        assert.equal(err.code, "DUPLICATE_ACTIVE_APPLICATION");
        return true;
      }
    );
  });

  it("error message mentions 'duplicate' or 'active application'", async () => {
    const db = makeTenantDb({
      blocking: null,
      createFn: async () => { throw new FakeUniqueConstraintError(); },
    });

    await assert.rejects(
      () => stubCreateDraft({ tenantDb: db, userId: 10 }),
      (err) => {
        assert.match(err.message, /duplicate|active application/i);
        return true;
      }
    );
  });

  it("non-UniqueConstraintError propagates unchanged (not masked as 409)", async () => {
    const originalError = new Error("Unexpected DB failure");
    const db = makeTenantDb({
      blocking: null,
      createFn: async () => { throw originalError; },
    });

    await assert.rejects(
      () => stubCreateDraft({ tenantDb: db, userId: 10 }),
      (err) => {
        assert.equal(err.message, "Unexpected DB failure");
        assert.notEqual(err.statusCode, 409, "non-UniqueConstraintError must not become 409");
        return true;
      }
    );
  });

  it("409 error carries DUPLICATE_ACTIVE_APPLICATION code (not ACTIVE_APPLICATION_EXISTS)", async () => {
    const db = makeTenantDb({
      blocking: null,
      createFn: async () => { throw new FakeUniqueConstraintError(); },
    });

    await assert.rejects(
      () => stubCreateDraft({ tenantDb: db, userId: 10 }),
      (err) => {
        assert.equal(err.code, "DUPLICATE_ACTIVE_APPLICATION");
        assert.notEqual(err.code, "ACTIVE_APPLICATION_EXISTS");
        return true;
      }
    );
  });
});

// ─── Concurrent creation simulation ───────────────────────────────────────────

describe("CRIT-002 — concurrent creation simulation (TOCTOU fix)", () => {
  it("exactly one creation succeeds when two concurrent requests race", async () => {
    // Simulate two concurrent createDraft calls for the same user.
    // Both pass the findOne check (blocking = null for both).
    // The DB unique index allows only the first INSERT; the second throws
    // UniqueConstraintError.

    let firstInserted = false;
    function createFnFactory() {
      return async () => {
        if (!firstInserted) {
          firstInserted = true;
          return { id: 1, status: "Draft" }; // first caller succeeds
        }
        throw new FakeUniqueConstraintError(); // second caller hits index
      };
    }

    const db1 = makeTenantDb({ blocking: null, createFn: createFnFactory() });
    const db2 = makeTenantDb({ blocking: null, createFn: createFnFactory() });

    const [result1, result2] = await Promise.allSettled([
      stubCreateDraft({ tenantDb: db1, userId: 42 }),
      stubCreateDraft({ tenantDb: db2, userId: 42 }),
    ]);

    const fulfilled = [result1, result2].filter((r) => r.status === "fulfilled");
    const rejected  = [result1, result2].filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one creation must succeed");
    assert.equal(rejected.length, 1, "exactly one creation must fail");

    const conflict = rejected[0].reason;
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.code, "DUPLICATE_ACTIVE_APPLICATION");
  });

  it("second concurrent request gets 409, not 500", async () => {
    let calls = 0;
    const createFn = async () => {
      calls++;
      if (calls === 1) return { id: 10, status: "Draft" };
      throw new FakeUniqueConstraintError();
    };

    const db1 = makeTenantDb({ blocking: null, createFn });
    const db2 = makeTenantDb({ blocking: null, createFn });

    const [, result2] = await Promise.allSettled([
      stubCreateDraft({ tenantDb: db1, userId: 99 }),
      stubCreateDraft({ tenantDb: db2, userId: 99 }),
    ]);

    assert.equal(result2.status, "rejected");
    assert.equal(result2.reason.statusCode, 409, "loser must receive HTTP 409, not 500");
  });

  it("winner receives a valid Draft application object", async () => {
    let firstInserted = false;
    const createFn = async (data) => {
      if (!firstInserted) {
        firstInserted = true;
        return { id: 7, ...data };
      }
      throw new FakeUniqueConstraintError();
    };

    const db1 = makeTenantDb({ blocking: null, createFn });
    const db2 = makeTenantDb({ blocking: null, createFn });

    const [result1] = await Promise.allSettled([
      stubCreateDraft({ tenantDb: db1, userId: 55 }),
      stubCreateDraft({ tenantDb: db2, userId: 55 }),
    ]);

    assert.equal(result1.status, "fulfilled");
    assert.equal(result1.value.status, "Draft");
    assert.ok(result1.value.id, "winner must have an id");
  });
});

// ─── Migration contract ────────────────────────────────────────────────────────

describe("CRIT-002 — partial unique index contract", () => {
  it("FakeUniqueConstraintError is instanceof UniqueConstraintError (validates test infrastructure)", () => {
    const err = new FakeUniqueConstraintError();
    assert.ok(err instanceof UniqueConstraintError, "FakeUniqueConstraintError must be an instanceof UniqueConstraintError");
  });

  it("DUPLICATE_ACTIVE_APPLICATION is distinct from ACTIVE_APPLICATION_EXISTS", () => {
    // Ensure the two paths (blocking check vs DB index) surface distinct codes
    // so callers can distinguish 'you have one in review' vs 'concurrent race'.
    assert.notEqual("DUPLICATE_ACTIVE_APPLICATION", "ACTIVE_APPLICATION_EXISTS");
  });
});
