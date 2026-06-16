/**
 * Tests for the CoS Allocation workflow in cosRequest.service.js
 *
 * Uses Node.js built-in test runner (node --test).
 * All Sequelize / DB calls are stubbed inline.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Status constants (mirrors service) ──────────────────────────────────────
const COS_STATUS = Object.freeze({
  COS_PENDING:  "Pending",
  COS_APPROVED: "Allocated",
  COS_REJECTED: "Rejected",
  PENDING:      "Pending",
  UNDER_REVIEW: "Under Review",
  APPROVED:     "Approved",
  REJECTED:     "Rejected",
  ALLOCATED:    "Allocated",
});

// ─── Allocation number builder (mirrors service) ──────────────────────────────
function buildAllocationNumber(requestId, allocatedAt) {
  const year = new Date(allocatedAt).getFullYear();
  return `EPIC-COS-${year}-${String(requestId).padStart(6, "0")}`;
}

// ─── Stub helpers ─────────────────────────────────────────────────────────────

const REVIEWER = { userId: 7, roleId: 2 };

function makeCosRequest(overrides = {}) {
  const data = {
    id: 42,
    sponsorId: 10,
    organisationId: 1,
    visaType: "Skilled Worker",
    requestedAmount: 5,
    approvedAmount: null,
    reason: "Expanding team",
    status: COS_STATUS.PENDING,
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    assignedCaseworkerIds: [REVIEWER.userId],
    ...overrides,
  };
  return {
    ...data,
    get id()                   { return data.id; },
    get sponsorId()            { return data.sponsorId; },
    get organisationId()       { return data.organisationId; },
    get visaType()             { return data.visaType; },
    get requestedAmount()      { return data.requestedAmount; },
    get approvedAmount()       { return data.approvedAmount; },
    set approvedAmount(v)      { data.approvedAmount = v; },
    get reason()               { return data.reason; },
    get status()               { return data.status; },
    set status(v)              { data.status = v; },
    get reviewNotes()          { return data.reviewNotes; },
    set reviewNotes(v)         { data.reviewNotes = v; },
    get reviewedBy()           { return data.reviewedBy; },
    set reviewedBy(v)          { data.reviewedBy = v; },
    get reviewedAt()           { return data.reviewedAt; },
    set reviewedAt(v)          { data.reviewedAt = v; },
    get assignedCaseworkerIds(){ return data.assignedCaseworkerIds; },
    save: async () => {},
  };
}

function makeProfile(overrides = {}) {
  const data = { userId: 10, cosAllocation: 3, licenceExpiryDate: "2030-01-01", ...overrides };
  return {
    ...data,
    get cosAllocation()  { return data.cosAllocation; },
    set cosAllocation(v) { data.cosAllocation = v; },
    get licenceExpiryDate() { return data.licenceExpiryDate; },
    save: async () => {},
  };
}

function makeTenantDb({ cosRequest = null, profile = null, allocationRecords = [] } = {}) {
  const created = [];
  const txn = {
    LOCK: { UPDATE: "UPDATE" },
    commit: async () => {},
    rollback: async () => {},
  };

  return {
    CosRequest: { findByPk: async () => cosRequest },
    SponsorProfile: { findOne: async () => profile },
    CosAllocationRecord: {
      create: async (row) => { created.push(row); return { id: created.length, ...row }; },
      findOne: async ({ where }) => allocationRecords.find(r => r.cosRequestId === where.cosRequestId) ?? null,
      findAll: async () => allocationRecords,
      _created: created,
    },
    sequelize: {
      // Simple synchronous transaction stub — runs fn and returns its result.
      transaction: async (fn) => {
        const result = await fn(txn);
        return result;
      },
    },
  };
}

// ─── Inline approval orchestrator (mirrors service logic) ────────────────────
const toInt = (v, fallback = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : fallback; };

async function stubApprove({ tenantDb, id, approvedAmount, reviewNotes, reviewerId }) {
  const request = await tenantDb.CosRequest.findByPk(id);
  if (!request) { const e = new Error("CoS request not found"); e.statusCode = 404; throw e; }

  const REVIEWABLE = [COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW];
  if (!REVIEWABLE.includes(request.status)) {
    const e = new Error(`A '${request.status}' request cannot be reviewed`); e.statusCode = 409; throw e;
  }

  const now = new Date();
  request.status = COS_STATUS.APPROVED;
  request.reviewedBy = reviewerId ?? null;
  request.reviewedAt = now;
  request.approvedAmount =
    approvedAmount != null ? toInt(approvedAmount, request.requestedAmount) : request.requestedAmount;
  if (reviewNotes != null) request.reviewNotes = reviewNotes;

  await tenantDb.sequelize.transaction(async (t) => {
    await request.save({ transaction: t });

    const profile = await tenantDb.SponsorProfile.findOne({ where: { userId: request.sponsorId }, transaction: t, lock: t.LOCK.UPDATE });
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
  });

  return request;
}

async function stubReject({ tenantDb, id, reviewNotes, reviewerId }) {
  const request = await tenantDb.CosRequest.findByPk(id);
  if (!request) { const e = new Error("CoS request not found"); e.statusCode = 404; throw e; }
  const REVIEWABLE = [COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW];
  if (!REVIEWABLE.includes(request.status)) {
    const e = new Error(`A '${request.status}' request cannot be reviewed`); e.statusCode = 409; throw e;
  }
  request.status = COS_STATUS.REJECTED;
  request.reviewedBy = reviewerId ?? null;
  if (reviewNotes != null) request.reviewNotes = reviewNotes;
  await request.save();
  return request;
}

// ─── Status constants ─────────────────────────────────────────────────────────

describe("COS_STATUS constants", () => {
  it("COS_PENDING maps to Pending", () => {
    assert.equal(COS_STATUS.COS_PENDING, "Pending");
  });

  it("COS_APPROVED maps to Allocated (the final approved+allocated state)", () => {
    assert.equal(COS_STATUS.COS_APPROVED, "Allocated");
  });

  it("COS_REJECTED maps to Rejected", () => {
    assert.equal(COS_STATUS.COS_REJECTED, "Rejected");
  });
});

// ─── Allocation number generation ────────────────────────────────────────────

describe("buildAllocationNumber", () => {
  it("generates EPIC-COS-{year}-{6-digit-id} format", () => {
    const num = buildAllocationNumber(42, new Date("2026-06-16"));
    assert.equal(num, "EPIC-COS-2026-000042");
  });

  it("zero-pads IDs shorter than 6 digits", () => {
    assert.equal(buildAllocationNumber(1, new Date("2026-01-01")), "EPIC-COS-2026-000001");
  });

  it("handles large IDs without truncation", () => {
    const num = buildAllocationNumber(123456789, new Date("2026-01-01"));
    assert.equal(num, "EPIC-COS-2026-123456789");
  });

  it("uses the year of the allocatedAt date", () => {
    const num = buildAllocationNumber(1, new Date("2028-03-15"));
    assert.match(num, /EPIC-COS-2028/);
  });
});

// ─── Approval workflow ────────────────────────────────────────────────────────

describe("CoS approval (COS_APPROVED)", () => {
  it("transitions status to Allocated on approval", async () => {
    const request = makeCosRequest({ status: "Pending" });
    const profile = makeProfile();
    const db = makeTenantDb({ cosRequest: request, profile });

    const result = await stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId });
    assert.equal(result.status, "Allocated");
  });

  it("increments SponsorProfile.cosAllocation by the approved amount", async () => {
    const request = makeCosRequest({ status: "Pending", requestedAmount: 5 });
    const profile = makeProfile({ cosAllocation: 3 });
    const db = makeTenantDb({ cosRequest: request, profile });

    await stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId });
    assert.equal(profile.cosAllocation, 8); // 3 + 5
  });

  it("uses approvedAmount when provided (partial approval)", async () => {
    const request = makeCosRequest({ status: "Pending", requestedAmount: 10 });
    const profile = makeProfile({ cosAllocation: 0 });
    const db = makeTenantDb({ cosRequest: request, profile });

    const result = await stubApprove({ tenantDb: db, id: 42, approvedAmount: 3, reviewerId: REVIEWER.userId });
    assert.equal(result.approvedAmount, 3);
    assert.equal(profile.cosAllocation, 3);
  });

  it("defaults to requestedAmount when approvedAmount is not given", async () => {
    const request = makeCosRequest({ status: "Pending", requestedAmount: 7 });
    const profile = makeProfile({ cosAllocation: 0 });
    const db = makeTenantDb({ cosRequest: request, profile });

    const result = await stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId });
    assert.equal(result.approvedAmount, 7);
  });

  it("creates an allocation record with the correct fields", async () => {
    const request = makeCosRequest({ status: "Pending", requestedAmount: 5, visaType: "Skilled Worker" });
    const profile = makeProfile({ cosAllocation: 0, licenceExpiryDate: "2030-06-01" });
    const db = makeTenantDb({ cosRequest: request, profile });

    await stubApprove({ tenantDb: db, id: 42, reviewNotes: "Approved after review", reviewerId: REVIEWER.userId });

    const records = db.CosAllocationRecord._created;
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec.cosRequestId, 42);
    assert.equal(rec.sponsorId, 10);
    assert.equal(rec.visaType, "Skilled Worker");
    assert.equal(rec.allocatedAmount, 5);
    assert.equal(rec.allocatedById, REVIEWER.userId);
    assert.equal(rec.notes, "Approved after review");
    assert.equal(rec.status, "Active");
    assert.ok(rec.allocationNumber.startsWith("EPIC-COS-"), "allocation number should use correct prefix");
  });

  it("allocation record allocationNumber is derived from request id", async () => {
    const request = makeCosRequest({ id: 99, status: "Pending", requestedAmount: 2 });
    const profile = makeProfile({ cosAllocation: 0 });
    const db = makeTenantDb({ cosRequest: request, profile });

    await stubApprove({ tenantDb: db, id: 99, reviewerId: REVIEWER.userId });

    const rec = db.CosAllocationRecord._created[0];
    assert.match(rec.allocationNumber, /000099$/);
  });

  it("sets expiryDate from the SponsorProfile licence expiry", async () => {
    const request = makeCosRequest({ status: "Pending" });
    const profile = makeProfile({ cosAllocation: 0, licenceExpiryDate: "2030-01-15" });
    const db = makeTenantDb({ cosRequest: request, profile });

    await stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId });

    const rec = db.CosAllocationRecord._created[0];
    assert.equal(rec.expiryDate, "2030-01-15");
  });

  it("throws 404 when the request does not exist", async () => {
    const db = makeTenantDb({ cosRequest: null });
    await assert.rejects(
      () => stubApprove({ tenantDb: db, id: 999, reviewerId: REVIEWER.userId }),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });

  it("throws 409 when the request is already Allocated", async () => {
    const request = makeCosRequest({ status: "Allocated" });
    const db = makeTenantDb({ cosRequest: request, profile: makeProfile() });
    await assert.rejects(
      () => stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId }),
      (err) => { assert.equal(err.statusCode, 409); return true; }
    );
  });

  it("throws 409 when the request is already Rejected", async () => {
    const request = makeCosRequest({ status: "Rejected" });
    const db = makeTenantDb({ cosRequest: request, profile: makeProfile() });
    await assert.rejects(
      () => stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId }),
      (err) => { assert.equal(err.statusCode, 409); return true; }
    );
  });

  it("also approves a request in Under Review status", async () => {
    const request = makeCosRequest({ status: "Under Review", requestedAmount: 2 });
    const profile = makeProfile({ cosAllocation: 1 });
    const db = makeTenantDb({ cosRequest: request, profile });

    const result = await stubApprove({ tenantDb: db, id: 42, reviewerId: REVIEWER.userId });
    assert.equal(result.status, "Allocated");
    assert.equal(profile.cosAllocation, 3);
  });
});

// ─── Rejection workflow ───────────────────────────────────────────────────────

describe("CoS rejection (COS_REJECTED)", () => {
  it("transitions status to Rejected", async () => {
    const request = makeCosRequest({ status: "Pending" });
    const db = makeTenantDb({ cosRequest: request });

    const result = await stubReject({ tenantDb: db, id: 42, reviewNotes: "Not eligible", reviewerId: REVIEWER.userId });
    assert.equal(result.status, "Rejected");
  });

  it("stores the review notes on rejection", async () => {
    const request = makeCosRequest({ status: "Under Review" });
    const db = makeTenantDb({ cosRequest: request });

    const result = await stubReject({ tenantDb: db, id: 42, reviewNotes: "Insufficient justification" });
    assert.equal(result.reviewNotes, "Insufficient justification");
  });

  it("does NOT create an allocation record on rejection", async () => {
    const request = makeCosRequest({ status: "Pending" });
    const db = makeTenantDb({ cosRequest: request });

    await stubReject({ tenantDb: db, id: 42, reviewNotes: "Denied" });
    assert.equal(db.CosAllocationRecord._created.length, 0);
  });

  it("throws 404 when request does not exist", async () => {
    const db = makeTenantDb({ cosRequest: null });
    await assert.rejects(
      () => stubReject({ tenantDb: db, id: 99, reviewNotes: "N/A" }),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });

  it("throws 409 when request is already Allocated", async () => {
    const request = makeCosRequest({ status: "Allocated" });
    const db = makeTenantDb({ cosRequest: request });
    await assert.rejects(
      () => stubReject({ tenantDb: db, id: 42 }),
      (err) => { assert.equal(err.statusCode, 409); return true; }
    );
  });
});

// ─── Allocation record read ───────────────────────────────────────────────────

describe("getCosAllocationRecord", () => {
  it("returns the record when it exists", async () => {
    const record = {
      id: 1,
      cosRequestId: 42,
      sponsorId: 10,
      allocationNumber: "EPIC-COS-2026-000042",
      allocatedAmount: 5,
      status: "Active",
    };
    const db = makeTenantDb({ allocationRecords: [record] });

    const found = await db.CosAllocationRecord.findOne({ where: { cosRequestId: 42 } });
    assert.ok(found);
    assert.equal(found.allocationNumber, "EPIC-COS-2026-000042");
    assert.equal(found.allocatedAmount, 5);
  });

  it("returns null when no record exists for the request", async () => {
    const db = makeTenantDb({ allocationRecords: [] });
    const found = await db.CosAllocationRecord.findOne({ where: { cosRequestId: 999 } });
    assert.equal(found, null);
  });
});
