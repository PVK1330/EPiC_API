import test from "node:test";
import assert from "node:assert";
import { assignCosRequest } from "../src/services/cosRequest.service.js";

function makeTransaction() {
  const t = {
    committed: false,
    rolledBack: false,
    commit: async () => { t.committed = true; },
    rollback: async () => { t.rolledBack = true; },
  };
  return t;
}

function makeTenantDb(requestData, caseworkersList) {
  const transaction = makeTransaction();
  const db = {
    sequelize: {
      transaction: async () => transaction,
    },
    CosRequest: {
      findByPk: async (id, opts) => {
        assert.ok(opts && opts.lock, "Must fetch request with lock");
        assert.ok(opts && opts.transaction, "Must fetch request with transaction");
        return {
          ...requestData,
          save: async (saveOpts) => {
            assert.ok(saveOpts && saveOpts.transaction, "Must save with transaction");
            requestData.assignedCaseworkerIds = requestData.assignedCaseworkerIds || [];
            requestData.status = "Under Review";
          },
        };
      },
    },
    User: {
      findAll: async () => caseworkersList,
      findByPk: async () => ({ id: 999, email: "test@test.com" }),
    },
    AuditLog: {
      create: async () => {},
    },
    Notification: {
      create: async () => {},
    },
  };
  return { db, transaction };
}

test("assignCosRequest: successfully assigns when status is Pending", async () => {
  const request = { id: 5, status: "Pending", sponsorId: 10, assignedCaseworkerIds: [] };
  const caseworkers = [{ id: 22, role_id: 2, status: "active" }];
  const { db, transaction } = makeTenantDb(request, caseworkers);

  const result = await assignCosRequest({
    tenantDb: db,
    id: 5,
    caseworkerIds: [22],
    actorId: 1,
  });

  assert.ok(transaction.committed);
  assert.strictEqual(result.status, "Under Review");
  assert.deepStrictEqual(result.assignedCaseworkerIds, [22]);
});

test("assignCosRequest: blocks and rolls back when status is not Pending (FSM validation inside lock)", async () => {
  // If a concurrent call already moved the status to Under Review
  const request = { id: 5, status: "Under Review", sponsorId: 10, assignedCaseworkerIds: [22] };
  const caseworkers = [{ id: 22, role_id: 2, status: "active" }];
  const { db, transaction } = makeTenantDb(request, caseworkers);

  await assert.rejects(
    () => assignCosRequest({
      tenantDb: db,
      id: 5,
      caseworkerIds: [22],
      actorId: 1,
    }),
    (err) => {
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.code, "INVALID_TRANSITION");
      return true;
    }
  );

  assert.ok(transaction.rolledBack);
});
