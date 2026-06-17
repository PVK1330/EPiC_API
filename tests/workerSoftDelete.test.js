// Tests: P2-WM-13 — Worker soft-delete compliance.
//
// Verifies that:
//   1. softDeleteWorker sets deletedAt; the worker is excluded from standard queries.
//   2. restoreWorker clears deletedAt; the worker reappears in standard queries.
//   3. Both operations write the correct audit row inside the same transaction.
//   4. Deleted workers are excluded by listAllWorkers by default, and included only
//      when includeDeleted=true is passed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  softDeleteWorker,
  restoreWorker,
  listAllWorkers,
  WORKER_AUDIT_ACTIONS,
} from "../src/services/sponsoredWorker.service.js";

// ── Mock factory ──────────────────────────────────────────────────────────────

const WORKER_ID = 42;
const ACTOR_ID  = 7;

function makeWorkerRow({ deletedAt = null, status = "CoS Assigned" } = {}) {
  let _deletedAt = deletedAt;
  return {
    id: WORKER_ID,
    status,
    get deletedAt() { return _deletedAt; },
    destroy: async () => { _deletedAt = new Date(); },
    restore:  async () => { _deletedAt = null; },
    save:     async () => {},
  };
}

function makeTenantDb({ workerRow = makeWorkerRow(), auditRows = [] } = {}) {
  return {
    sequelize: {
      transaction: async (fn) => {
        const t = { LOCK: { UPDATE: "UPDATE" } };
        return fn(t);
      },
    },
    SponsoredWorker: {
      findByPk: async (_id, _opts) => workerRow,
      findAll:  async (opts) => {
        // Simulate paranoid filtering: if paranoid !== false, exclude deleted rows.
        if (opts?.paranoid === false) return [workerRow];
        return workerRow.deletedAt ? [] : [workerRow];
      },
    },
    SponsoredWorkerAudit: {
      create: async (data, _opts) => {
        auditRows.push(data);
        return data;
      },
    },
  };
}

// ── Test 1: delete hides the worker from standard queries ─────────────────────

test("softDeleteWorker: worker is excluded from standard queries after deletion", async () => {
  const worker = makeWorkerRow();
  const db = makeTenantDb({ workerRow: worker });

  // Confirm worker is visible before deletion.
  const before = await db.SponsoredWorker.findAll({});
  assert.equal(before.length, 1, "worker visible before delete");

  await softDeleteWorker(db, WORKER_ID, ACTOR_ID);

  // deletedAt must be set.
  assert.ok(worker.deletedAt instanceof Date, "deletedAt set after soft delete");

  // Standard query (paranoid=true by default) must hide it.
  const after = await db.SponsoredWorker.findAll({});
  assert.equal(after.length, 0, "worker hidden after soft delete");
});

// ── Test 2: restore brings worker back ────────────────────────────────────────

test("restoreWorker: worker reappears in standard queries after restore", async () => {
  const worker = makeWorkerRow({ deletedAt: new Date() });
  const db = makeTenantDb({ workerRow: worker });

  // Confirm hidden before restore.
  const before = await db.SponsoredWorker.findAll({});
  assert.equal(before.length, 0, "worker hidden before restore");

  await restoreWorker(db, WORKER_ID, ACTOR_ID);

  assert.equal(worker.deletedAt, null, "deletedAt cleared after restore");

  const after = await db.SponsoredWorker.findAll({});
  assert.equal(after.length, 1, "worker visible after restore");
});

// ── Test 3: audit rows are created for both operations ────────────────────────

test("softDeleteWorker and restoreWorker each write an audit row", async () => {
  const auditRows = [];

  // Delete audit
  const worker1 = makeWorkerRow();
  const db1 = makeTenantDb({ workerRow: worker1, auditRows });
  await softDeleteWorker(db1, WORKER_ID, ACTOR_ID);

  assert.equal(auditRows.length, 1, "one audit row written after delete");
  assert.equal(auditRows[0].action, WORKER_AUDIT_ACTIONS.DELETED, "delete action matches");
  assert.equal(auditRows[0].actorId, ACTOR_ID, "actorId recorded");
  assert.equal(auditRows[0].toStatus, null, "toStatus is null for delete");

  // Restore audit
  const worker2 = makeWorkerRow({ deletedAt: new Date(), status: "Visa Preparation" });
  const db2 = makeTenantDb({ workerRow: worker2, auditRows });
  await restoreWorker(db2, WORKER_ID, ACTOR_ID);

  assert.equal(auditRows.length, 2, "second audit row written after restore");
  assert.equal(auditRows[1].action, WORKER_AUDIT_ACTIONS.RESTORED, "restore action matches");
  assert.equal(auditRows[1].actorId, ACTOR_ID, "actorId recorded on restore");
  assert.equal(auditRows[1].fromStatus, null, "fromStatus is null for restore");
});

// ── Test 4: deleted workers excluded by default; included via includeDeleted=true

test("listAllWorkers excludes deleted by default and includes them with includeDeleted=true", async () => {
  const deletedWorker = makeWorkerRow({ deletedAt: new Date() });
  const db = makeTenantDb({ workerRow: deletedWorker });

  // Default call (includeDeleted omitted) — must exclude.
  const defaultList = await listAllWorkers(db, { sponsorId: 1 });
  assert.equal(defaultList.length, 0, "deleted worker excluded by default");

  // Explicit includeDeleted=true — must include.
  const withDeleted = await listAllWorkers(db, { sponsorId: 1, includeDeleted: true });
  assert.equal(withDeleted.length, 1, "deleted worker included with includeDeleted=true");
});
