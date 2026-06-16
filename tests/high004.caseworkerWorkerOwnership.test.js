import test from "node:test";
import assert from "node:assert";
import { createWorkerHandler } from "../src/modules/Caseworker/Workers/caseworkerWorker.controller.js";

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

function makeMockDb({ cosRequest = null, allocation = null, licenceApplication = null } = {}) {
  return {
    CosRequest: {
      findByPk: async () => cosRequest,
    },
    CosAllocationRecord: {
      findByPk: async () => allocation,
    },
    LicenceApplication: {
      findAll: async () => (licenceApplication ? [licenceApplication] : []),
    },
    SponsoredWorker: {
      create: async (data) => ({ id: 101, ...data }),
    },
    SponsoredWorkerAudit: {
      create: async () => {},
    },
  };
}

test("createWorkerHandler: Admin bypasses ownership and succeeds", async () => {
  const db = makeMockDb({});
  const req = {
    user: { role_id: 3, userId: 1 }, // Admin
    tenantDb: db,
    body: {
      sponsorId: 10,
      workerFirstName: "John",
      workerLastName: "Doe",
    },
  };
  const res = mockRes();

  await createWorkerHandler(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.sentData.status, "success");
});

test("createWorkerHandler: Assigned caseworker (on LicenceApplication) succeeds", async () => {
  // Caseworker 22 is assigned to the sponsor's licence application
  const db = makeMockDb({
    licenceApplication: { id: 1, assignedcaseworkerId: [22] },
  });
  const req = {
    user: { role_id: 2, userId: 22 }, // Caseworker 22
    tenantDb: db,
    body: {
      sponsorId: 10,
      workerFirstName: "John",
      workerLastName: "Doe",
    },
  };
  const res = mockRes();

  await createWorkerHandler(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.sentData.status, "success");
});

test("createWorkerHandler: Assigned caseworker (on CosRequest) succeeds", async () => {
  // Caseworker 22 is assigned to the CosRequest
  const db = makeMockDb({
    cosRequest: { id: 5, sponsorId: 10, assignedCaseworkerIds: [22] },
  });
  const req = {
    user: { role_id: 2, userId: 22 },
    tenantDb: db,
    body: {
      sponsorId: 10,
      cosRequestId: 5,
      workerFirstName: "John",
      workerLastName: "Doe",
    },
  };
  const res = mockRes();

  await createWorkerHandler(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.sentData.status, "success");
});

test("createWorkerHandler: Unrelated caseworker is blocked (403)", async () => {
  // Caseworker 99 is not assigned to the licence application
  const db = makeMockDb({
    licenceApplication: { id: 1, assignedcaseworkerId: [22] },
  });
  const req = {
    user: { role_id: 2, userId: 99 }, // Unrelated caseworker
    tenantDb: db,
    body: {
      sponsorId: 10,
      workerFirstName: "John",
      workerLastName: "Doe",
    },
  };
  const res = mockRes();

  await createWorkerHandler(req, res);

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.sentData.status, "error");
  assert.ok(res.sentData.message.includes("not authorized"));
});
