import test from "node:test";
import assert from "node:assert";
import { ensureAssignedWorkerCaseworker } from "../src/middlewares/ensureAssignedWorkerCaseworker.middleware.js";

function mockRes() {
  const res = {
    statusCode: 200,
    sentData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.sentData = data;
      return this;
    },
  };
  return res;
}

function makeMockDb({ worker = null } = {}) {
  return {
    SponsoredWorker: {
      findByPk: async () => worker,
    },
    User: {
      findByPk: async () => ({ id: 999 }),
    },
    AuditLog: {
      create: async () => {},
    },
  };
}

test("ensureAssignedWorkerCaseworker: Admin bypasses guard and succeeds", async () => {
  const worker = { id: 101, status: "CoS Assigned", assignedCaseworkerIds: [22] };
  const db = makeMockDb({ worker });
  const req = {
    user: { role_id: 3, userId: 1 }, // Admin
    tenantDb: db,
    params: { id: "101" },
  };
  const res = mockRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  const middleware = ensureAssignedWorkerCaseworker();
  await middleware(req, res, next);

  assert.ok(nextCalled);
  assert.strictEqual(req.sponsoredWorker.id, 101);
});

test("ensureAssignedWorkerCaseworker: Assigned caseworker is allowed and succeeds", async () => {
  const worker = { id: 101, status: "CoS Assigned", assignedCaseworkerIds: [22] };
  const db = makeMockDb({ worker });
  const req = {
    user: { role_id: 2, userId: 22 }, // Caseworker 22 (assigned)
    tenantDb: db,
    params: { id: "101" },
  };
  const res = mockRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  const middleware = ensureAssignedWorkerCaseworker();
  await middleware(req, res, next);

  assert.ok(nextCalled);
  assert.strictEqual(req.sponsoredWorker.id, 101);
});

test("ensureAssignedWorkerCaseworker: Unassigned caseworker is denied (403)", async () => {
  const worker = { id: 101, status: "CoS Assigned", assignedCaseworkerIds: [22] };
  const db = makeMockDb({ worker });
  const req = {
    user: { role_id: 2, userId: 99 }, // Unassigned caseworker
    tenantDb: db,
    params: { id: "101" },
    headers: {},
  };
  const res = mockRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  const middleware = ensureAssignedWorkerCaseworker();
  await middleware(req, res, next);

  assert.ok(!nextCalled);
  assert.strictEqual(res.statusCode, 403);
});

test("ensureAssignedWorkerCaseworker: Worker not found returns 404", async () => {
  const db = makeMockDb({ worker: null });
  const req = {
    user: { role_id: 2, userId: 22 },
    tenantDb: db,
    params: { id: "999" },
  };
  const res = mockRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  const middleware = ensureAssignedWorkerCaseworker();
  await middleware(req, res, next);

  assert.ok(!nextCalled);
  assert.strictEqual(res.statusCode, 404);
});
