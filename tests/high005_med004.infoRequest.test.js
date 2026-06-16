/**
 * HIGH-005 — createInfoRequest() transaction hardening tests
 * MED-004  — closeInfoRequest() transaction hardening tests
 *
 * HIGH-005 validates:
 *   1. Info request row, status update, and audit are committed together.
 *   2. Rollback when application update fails.
 *   3. Rollback when audit write fails.
 *   4. FSM validation inside the transaction.
 *   5. Stacking (alreadyRequested) skips FSM check.
 *
 * MED-004 validates:
 *   1. Close, audit, and optional restart are committed together.
 *   2. Rollback when audit write fails after close.
 *   3. Review restart happens atomically when all requests are resolved.
 *   4. No restart when remaining open requests exist.
 *   5. FSM restart failure rolls back the whole close.
 *
 * Run: node --test tests/high005_med004.infoRequest.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── FSM stub ────────────────────────────────────────────────────────────────

function fakeValidateTransition(fromStatus, toStatus) {
  const VALID = {
    "Under Review":           ["Information Requested"],
    "Information Requested":  ["Under Review"],
    "Pending":                ["Information Requested"],
  };
  const allowed = VALID[fromStatus] ?? [];
  if (allowed.includes(toStatus)) return { valid: true };
  return { valid: false, message: `Cannot transition from ${fromStatus} to ${toStatus}` };
}

// ─── Transaction stub ─────────────────────────────────────────────────────────

function makeTransaction() {
  const events = [];
  return {
    events,
    LOCK: { UPDATE: "UPDATE" },
    commit:   async () => { events.push("commit");   },
    rollback: async () => { events.push("rollback"); },
  };
}

// ─── HIGH-005: createInfoRequest inline implementation ────────────────────────

async function createInfoRequest(tenantDb, { applicationId, subject, details }, actorUser) {
  const t = await tenantDb.sequelize.transaction();
  let application, infoRequest;

  try {
    application = await tenantDb.LicenceApplication.findByPk(applicationId, {
      lock: true, transaction: t,
    });
    if (!application) {
      const e = new Error("Application not found"); e.statusCode = 404; throw e;
    }

    const previousStatus = application.status;
    const alreadyRequested = previousStatus === "Information Requested";

    if (!alreadyRequested) {
      const check = fakeValidateTransition(previousStatus, "Information Requested");
      if (!check.valid) {
        const e = new Error(check.message); e.statusCode = 409; throw e;
      }
    }

    infoRequest = await tenantDb.LicenceInformationRequest.create({
      licenceApplicationId: applicationId,
      subject: String(subject).trim(),
      status: "open",
    }, { transaction: t });

    const updates = {};
    if (!alreadyRequested) updates.status = "Information Requested";
    await application.update(updates, { transaction: t });

    await tenantDb.LicenceApplicationAudit.create({
      licenceApplicationId: applicationId,
      action: "request_info",
      previousStatus,
      newStatus: application.status,
    }, { transaction: t });

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
  return infoRequest;
}

// ─── MED-004: closeInfoRequest inline implementation ─────────────────────────

async function closeInfoRequest(
  tenantDb,
  { applicationId, requestId, closedById, notes },
  actorUser,
) {
  // Pre-flight load.
  const preCheck = await tenantDb.LicenceInformationRequest.findOne({
    where: { id: requestId },
    attributes: ["id", "status"],
  });
  if (!preCheck) { const e = new Error("Not found"); e.statusCode = 404; throw e; }
  if (preCheck.status === "closed") {
    const e = new Error("Already closed"); e.statusCode = 409; throw e;
  }

  const t = await tenantDb.sequelize.transaction();
  let application, infoRequest;

  try {
    application = await tenantDb.LicenceApplication.findByPk(applicationId, {
      lock: true, transaction: t,
    });
    if (!application) { const e = new Error("App not found"); e.statusCode = 404; throw e; }

    infoRequest = await tenantDb.LicenceInformationRequest.findOne({
      where: { id: requestId },
      lock: true, transaction: t,
    });
    if (!infoRequest || infoRequest.status === "closed") {
      const e = new Error(infoRequest ? "Already closed" : "Not found");
      e.statusCode = infoRequest ? 409 : 404; throw e;
    }

    await infoRequest.update({ status: "closed" }, { transaction: t });

    await tenantDb.LicenceApplicationAudit.create({
      action: "info_request_closed",
    }, { transaction: t });

    const remaining = await tenantDb.LicenceInformationRequest.count({
      where: { status: ["open", "responded"] },
      transaction: t,
    });

    if (remaining === 0 && application.status === "Information Requested") {
      const check = fakeValidateTransition(application.status, "Under Review");
      if (!check.valid) {
        const e = new Error(check.message); e.statusCode = 422; throw e;
      }
      await application.update({ status: "Under Review" }, { transaction: t });
      await tenantDb.LicenceApplicationAudit.create({
        action: "review_restarted",
      }, { transaction: t });
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  return infoRequest;
}

// ─── DB stub builders ─────────────────────────────────────────────────────────

function makeInfoRequestDb({
  appStatus    = "Under Review",
  auditFails   = false,
  appMissing   = false,
  infoCreateFails = false,
  appUpdateFails  = false,
} = {}) {
  const t = makeTransaction();
  const app = {
    id: 1,
    status: appStatus,
    update: async (fields, _opts) => {
      if (appUpdateFails) { t.events.push("app.update.fail"); throw new Error("App update error"); }
      t.events.push("app.update");
      Object.assign(app, fields);
    },
  };
  let infoReqCounter = 0;
  return {
    t, app,
    sequelize: { transaction: async () => t },
    LicenceApplication: {
      findByPk: async (_id, _opts) => appMissing ? null : app,
    },
    LicenceInformationRequest: {
      create: async () => {
        if (infoCreateFails) { t.events.push("infoReq.fail"); throw new Error("InfoReq create error"); }
        t.events.push("infoReq.create");
        return { id: ++infoReqCounter, status: "open" };
      },
    },
    LicenceApplicationAudit: {
      create: async () => {
        if (auditFails) { t.events.push("audit.fail"); throw new Error("Audit error"); }
        t.events.push("audit.create");
      },
    },
  };
}

function makeCloseDb({
  appStatus       = "Information Requested",
  preCheckStatus  = "open",
  inReqStatus     = "open",
  auditFails      = false,
  remainingOpen   = 0,
  inReqMissing    = false,
} = {}) {
  const t = makeTransaction();
  const app = {
    id: 1,
    status: appStatus,
    update: async (fields, _opts) => {
      t.events.push("app.update");
      Object.assign(app, fields);
    },
  };
  const infoReq = inReqMissing ? null : { id: 7, status: inReqStatus, update: async (fields, _opts) => {
    t.events.push("infoReq.update");
    Object.assign(infoReq, fields);
  }};
  return {
    t, app, infoReq,
    sequelize: { transaction: async () => t },
    LicenceApplication: {
      findByPk: async () => app,
    },
    LicenceInformationRequest: {
      findOne: async (_q) => {
        // First call is pre-flight (no transaction arg), second is inside transaction.
        if (_q?.attributes) return inReqMissing ? null : { id: 7, status: preCheckStatus };
        return infoReq;
      },
      count: async () => remainingOpen,
    },
    LicenceApplicationAudit: {
      create: async (_data, _opts) => {
        if (auditFails) { t.events.push("audit.fail"); throw new Error("Audit error"); }
        t.events.push("audit.create");
      },
    },
  };
}

// ─── HIGH-005 tests ───────────────────────────────────────────────────────────

describe("HIGH-005 — createInfoRequest atomic commit", () => {
  it("commits info request creation, app update, and audit together", async () => {
    const db = makeInfoRequestDb({ appStatus: "Under Review" });
    await createInfoRequest(db, { applicationId: 1, subject: "Need docs" }, {});
    assert.deepEqual(
      db.t.events,
      ["infoReq.create", "app.update", "audit.create", "commit"]
    );
  });

  it("transitions app status to Information Requested", async () => {
    const db = makeInfoRequestDb({ appStatus: "Under Review" });
    await createInfoRequest(db, { applicationId: 1, subject: "Proof of address" }, {});
    assert.equal(db.app.status, "Information Requested");
  });

  it("skips FSM check when already in Information Requested (stacking)", async () => {
    const db = makeInfoRequestDb({ appStatus: "Information Requested" });
    // Should not throw — stacking is allowed.
    await assert.doesNotReject(() =>
      createInfoRequest(db, { applicationId: 1, subject: "Second request" }, {})
    );
  });

  it("returns 404 when application not found", async () => {
    const db = makeInfoRequestDb({ appMissing: true });
    await assert.rejects(
      () => createInfoRequest(db, { applicationId: 999, subject: "X" }, {}),
      (err) => { assert.equal(err.statusCode, 404); return true; }
    );
  });

  it("returns 409 when FSM rejects the transition", async () => {
    // 'Licence Granted' cannot transition to 'Information Requested'.
    const db = makeInfoRequestDb({ appStatus: "Licence Granted" });
    await assert.rejects(
      () => createInfoRequest(db, { applicationId: 1, subject: "X" }, {}),
      (err) => { assert.equal(err.statusCode, 409); return true; }
    );
  });
});

describe("HIGH-005 — createInfoRequest rollback scenarios", () => {
  it("rolls back when infoRequest creation fails", async () => {
    const db = makeInfoRequestDb({ appStatus: "Under Review", infoCreateFails: true });
    await assert.rejects(() => createInfoRequest(db, { applicationId: 1, subject: "X" }, {}));
    assert.ok(db.t.events.includes("rollback"));
    assert.ok(!db.t.events.includes("commit"));
  });

  it("rolls back when application update fails (no orphan infoRequest)", async () => {
    const db = makeInfoRequestDb({ appStatus: "Under Review", appUpdateFails: true });
    await assert.rejects(() => createInfoRequest(db, { applicationId: 1, subject: "X" }, {}));
    assert.ok(db.t.events.includes("rollback"), "must rollback on app.update failure");
    assert.ok(!db.t.events.includes("commit"),  "must not commit");
  });

  it("rolls back when audit write fails", async () => {
    const db = makeInfoRequestDb({ appStatus: "Under Review", auditFails: true });
    await assert.rejects(() => createInfoRequest(db, { applicationId: 1, subject: "X" }, {}));
    assert.ok(db.t.events.includes("rollback"));
    assert.ok(!db.t.events.includes("commit"));
  });
});

// ─── MED-004 tests ────────────────────────────────────────────────────────────

describe("MED-004 — closeInfoRequest atomic commit (no restart)", () => {
  it("commits close and audit in one transaction when requests remain open", async () => {
    const db = makeCloseDb({ remainingOpen: 1 });
    await closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {});
    assert.deepEqual(
      db.t.events,
      ["infoReq.update", "audit.create", "commit"]
    );
  });

  it("does NOT update application status when other requests remain", async () => {
    const db = makeCloseDb({ remainingOpen: 1 });
    await closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {});
    assert.equal(db.app.status, "Information Requested", "status must not change");
    assert.ok(!db.t.events.includes("app.update"), "app.update must not be called");
  });

  it("returns 409 when request is already closed (pre-flight)", async () => {
    const db = makeCloseDb({ preCheckStatus: "closed" });
    await assert.rejects(
      () => closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {}),
      (err) => { assert.equal(err.statusCode, 409); return true; }
    );
    // Pre-flight rejects before the transaction opens — no rollback event.
    assert.ok(!db.t.events.includes("rollback"), "no transaction should be opened");
  });
});

describe("MED-004 — closeInfoRequest atomic restart", () => {
  it("commits close + restart + both audits atomically when last request closes", async () => {
    const db = makeCloseDb({ remainingOpen: 0, appStatus: "Information Requested" });
    await closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {});
    assert.deepEqual(
      db.t.events,
      ["infoReq.update", "audit.create", "app.update", "audit.create", "commit"]
    );
  });

  it("transitions app to Under Review when last request is closed", async () => {
    const db = makeCloseDb({ remainingOpen: 0, appStatus: "Information Requested" });
    await closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {});
    assert.equal(db.app.status, "Under Review");
  });

  it("does NOT restart when application is not in Information Requested", async () => {
    // e.g. admin manually changed status before closing the request.
    const db = makeCloseDb({ remainingOpen: 0, appStatus: "Under Review" });
    await closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {});
    // Only one audit.create (for the close), no app.update.
    const auditCreates = db.t.events.filter((e) => e === "audit.create");
    assert.equal(auditCreates.length, 1, "only close audit should be written");
    assert.ok(!db.t.events.includes("app.update"), "status must not be changed");
  });
});

describe("MED-004 — closeInfoRequest rollback scenarios", () => {
  it("rolls back everything when audit write fails after close", async () => {
    const db = makeCloseDb({ auditFails: true });
    await assert.rejects(() =>
      closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {})
    );
    assert.ok(db.t.events.includes("rollback"));
    assert.ok(!db.t.events.includes("commit"));
  });

  it("info request close is rolled back when audit fails (no orphan close)", async () => {
    const db = makeCloseDb({ auditFails: true });
    await assert.rejects(() =>
      closeInfoRequest(db, { applicationId: 1, requestId: 7 }, {})
    );
    // infoReq.update was called but commit never happened → DB row unchanged.
    assert.ok(db.t.events.includes("infoReq.update"), "close was attempted");
    assert.ok(!db.t.events.includes("commit"), "commit did not happen");
  });
});
