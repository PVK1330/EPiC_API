/**
 * FSM transition tests for ISSUE-005, ISSUE-007, ISSUE-015.
 *
 * Covers:
 *   1. CoS FSM matrix — valid and invalid transitions (ISSUE-005)
 *   2. CoS service stubs — assignCosRequest, reviewCosRequest, requestInfoCosRequest
 *      now route through validateTransition instead of REVIEWABLE arrays
 *   3. Sponsor forbidden mutation — Information Requested → Pending is blocked;
 *      Information Requested → Under Review is the correct FSM path (ISSUE-007)
 *   4. licenceInformationRequest closeInfoRequest FSM guard (ISSUE-015)
 *
 * Run with: node --test tests/workflowFsm.issues.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTransition, WORKFLOW_TYPES } from "../src/services/workflowEngine.service.js";

const COS   = WORKFLOW_TYPES.COS;
const LIC   = WORKFLOW_TYPES.LICENCE;

// ─── helpers ─────────────────────────────────────────────────────────────────

function allowed(from, to, type = COS, opts = {}) {
  return validateTransition(type, from, to, opts);
}

function assertAllowed(result, label) {
  assert.ok(result.valid, `Expected ALLOWED for: ${label} — got: ${result.message}`);
}

function assertBlocked(result, label) {
  assert.ok(!result.valid, `Expected BLOCKED for: ${label} — got: valid=true`);
}

// ─── 1. CoS FSM matrix (ISSUE-005) ───────────────────────────────────────────

describe("COS_REQUEST_TRANSITIONS matrix — valid paths", () => {
  it("Pending → Under Review (assignment)", () =>
    assertAllowed(allowed("Pending", "Under Review"), "Pending → Under Review"));

  it("Pending → Approved (direct approve without caseworker)", () =>
    assertAllowed(allowed("Pending", "Approved"), "Pending → Approved"));

  it("Pending → Rejected", () =>
    assertAllowed(allowed("Pending", "Rejected"), "Pending → Rejected"));

  it("Under Review → Approved", () =>
    assertAllowed(allowed("Under Review", "Approved"), "Under Review → Approved"));

  it("Under Review → Rejected", () =>
    assertAllowed(allowed("Under Review", "Rejected"), "Under Review → Rejected"));

  it("Approved → Allocated (post-approval allocation step)", () =>
    assertAllowed(allowed("Approved", "Allocated"), "Approved → Allocated"));

  it("Allocated → Used", () =>
    assertAllowed(allowed("Allocated", "Used"), "Allocated → Used"));

  it("Allocated → Expired", () =>
    assertAllowed(allowed("Allocated", "Expired"), "Allocated → Expired"));

  it("Allocated → Revoked", () =>
    assertAllowed(allowed("Allocated", "Revoked"), "Allocated → Revoked"));
});

describe("COS_REQUEST_TRANSITIONS matrix — blocked paths", () => {
  it("Pending → Allocated (skips Approved step)", () =>
    assertBlocked(allowed("Pending", "Allocated"), "Pending → Allocated"));

  it("Allocated → Approved (terminal state cannot go backwards)", () =>
    assertBlocked(allowed("Allocated", "Approved"), "Allocated → Approved"));

  it("Rejected → Approved (terminal state)", () =>
    assertBlocked(allowed("Rejected", "Approved"), "Rejected → Approved"));

  it("Rejected → Under Review (terminal state)", () =>
    assertBlocked(allowed("Rejected", "Under Review"), "Rejected → Under Review"));

  it("Used → Pending (terminal state)", () =>
    assertBlocked(allowed("Used", "Pending"), "Used → Pending"));

  it("Revoked → Pending (terminal state)", () =>
    assertBlocked(allowed("Revoked", "Pending"), "Revoked → Pending"));

  it("Under Review → Pending (backwards step not in matrix)", () =>
    assertBlocked(allowed("Under Review", "Pending"), "Under Review → Pending"));

  it("Approved → Pending (backwards step)", () =>
    assertBlocked(allowed("Approved", "Pending"), "Approved → Pending"));

  it("unknown currentState is blocked", () => {
    const r = allowed("FABRICATED_STATUS", "Pending");
    assertBlocked(r, "FABRICATED_STATUS → Pending");
    assert.match(r.message, /terminal|unrecognized/i);
  });
});

// ─── 2. CoS service stubs (ISSUE-005) ────────────────────────────────────────
// These stubs mirror the updated service function logic so we can verify the
// FSM-routing behaviour without a real database.

function makeRequest(status, id = 1) {
  const data = { id, status, assignedCaseworkerIds: null, reviewNotes: null };
  return {
    ...data,
    get status() { return data.status; },
    set status(v) { data.status = v; },
    get assignedCaseworkerIds() { return data.assignedCaseworkerIds; },
    set assignedCaseworkerIds(v) { data.assignedCaseworkerIds = v; },
    get reviewNotes() { return data.reviewNotes; },
    set reviewNotes(v) { data.reviewNotes = v; },
    save: async () => {},
  };
}

const COS_STATUS = Object.freeze({
  PENDING:      "Pending",
  UNDER_REVIEW: "Under Review",
  APPROVED:     "Approved",
  REJECTED:     "Rejected",
  ALLOCATED:    "Allocated",
});

// Inline stub for assignCosRequest — mirrors new FSM-routed code
async function stubAssignCosRequest(request) {
  const check = validateTransition(COS, request.status, COS_STATUS.UNDER_REVIEW);
  if (!check.valid) {
    const e = new Error(check.message); e.statusCode = 409; e.code = "INVALID_TRANSITION"; throw e;
  }
  request.status = COS_STATUS.UNDER_REVIEW;
  return request;
}

// Inline stub for reviewCosRequest — mirrors new FSM-routed code
async function stubReviewCosRequest(request, action) {
  if (!["approve", "reject"].includes(action)) throw Object.assign(new Error("Invalid action"), { statusCode: 400 });
  const newStatus = action === "approve" ? COS_STATUS.APPROVED : COS_STATUS.REJECTED;
  const check = validateTransition(COS, request.status, newStatus);
  if (!check.valid) {
    const e = new Error(check.message); e.statusCode = 409; e.code = "INVALID_TRANSITION"; throw e;
  }
  request.status = newStatus;
  return request;
}

// Inline stub for requestInfoCosRequest — mirrors new FSM-routed code
async function stubRequestInfoCosRequest(request) {
  if (request.status === COS_STATUS.PENDING) {
    const check = validateTransition(COS, COS_STATUS.PENDING, COS_STATUS.UNDER_REVIEW);
    if (!check.valid) { const e = new Error(check.message); e.statusCode = 409; throw e; }
    request.status = COS_STATUS.UNDER_REVIEW;
  } else if (request.status !== COS_STATUS.UNDER_REVIEW) {
    const { message } = validateTransition(COS, request.status, COS_STATUS.UNDER_REVIEW);
    const e = new Error(message); e.statusCode = 409; e.code = "INVALID_TRANSITION"; throw e;
  }
  return request;
}

describe("assignCosRequest — FSM routing (ISSUE-005)", () => {
  it("Pending → Under Review succeeds", async () => {
    const req = makeRequest("Pending");
    await stubAssignCosRequest(req);
    assert.equal(req.status, "Under Review");
  });

  it("throws 409 when request is already Under Review", async () => {
    const req = makeRequest("Under Review");
    await assert.rejects(() => stubAssignCosRequest(req), (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "INVALID_TRANSITION");
      return true;
    });
  });

  it("throws 409 when request is Approved (can't re-assign)", async () => {
    const req = makeRequest("Approved");
    await assert.rejects(() => stubAssignCosRequest(req), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });

  it("throws 409 when request is Allocated (terminal)", async () => {
    const req = makeRequest("Allocated");
    await assert.rejects(() => stubAssignCosRequest(req), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });
});

describe("reviewCosRequest — FSM routing (ISSUE-005)", () => {
  it("Pending → approve succeeds", async () => {
    const req = makeRequest("Pending");
    await stubReviewCosRequest(req, "approve");
    assert.equal(req.status, "Approved");
  });

  it("Pending → reject succeeds", async () => {
    const req = makeRequest("Pending");
    await stubReviewCosRequest(req, "reject");
    assert.equal(req.status, "Rejected");
  });

  it("Under Review → approve succeeds", async () => {
    const req = makeRequest("Under Review");
    await stubReviewCosRequest(req, "approve");
    assert.equal(req.status, "Approved");
  });

  it("Under Review → reject succeeds", async () => {
    const req = makeRequest("Under Review");
    await stubReviewCosRequest(req, "reject");
    assert.equal(req.status, "Rejected");
  });

  it("Allocated → approve throws 409 (terminal state)", async () => {
    const req = makeRequest("Allocated");
    await assert.rejects(() => stubReviewCosRequest(req, "approve"), (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "INVALID_TRANSITION");
      return true;
    });
  });

  it("Rejected → approve throws 409 (terminal state)", async () => {
    const req = makeRequest("Rejected");
    await assert.rejects(() => stubReviewCosRequest(req, "approve"), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });

  it("Approved → reject throws 409 (already decided)", async () => {
    const req = makeRequest("Approved");
    await assert.rejects(() => stubReviewCosRequest(req, "reject"), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });

  it("error message names the illegal transition", async () => {
    const req = makeRequest("Allocated");
    await assert.rejects(() => stubReviewCosRequest(req, "approve"), (err) => {
      assert.match(err.message, /Allocated/);
      return true;
    });
  });
});

describe("requestInfoCosRequest — FSM routing (ISSUE-005)", () => {
  it("Pending → advances to Under Review", async () => {
    const req = makeRequest("Pending");
    await stubRequestInfoCosRequest(req);
    assert.equal(req.status, "Under Review");
  });

  it("Under Review → status unchanged (already in review)", async () => {
    const req = makeRequest("Under Review");
    await stubRequestInfoCosRequest(req);
    assert.equal(req.status, "Under Review");
  });

  it("Approved → throws 409", async () => {
    const req = makeRequest("Approved");
    await assert.rejects(() => stubRequestInfoCosRequest(req), (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "INVALID_TRANSITION");
      return true;
    });
  });

  it("Allocated → throws 409 (terminal state)", async () => {
    const req = makeRequest("Allocated");
    await assert.rejects(() => stubRequestInfoCosRequest(req), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });

  it("Rejected → throws 409 (terminal state)", async () => {
    const req = makeRequest("Rejected");
    await assert.rejects(() => stubRequestInfoCosRequest(req), (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    });
  });
});

// ─── 3. Sponsor forbidden mutation (ISSUE-007) ───────────────────────────────

describe("LICENCE FSM — sponsor status mutation guard (ISSUE-007)", () => {
  it("Information Requested → Pending is NOT in the matrix (the old bug)", () => {
    const r = validateTransition(LIC, "Information Requested", "Pending");
    assertBlocked(r, "Information Requested → Pending");
    assert.match(r.message, /Invalid transition/i);
  });

  it("Information Requested → Under Review IS valid (the correct fix)", () => {
    const r = validateTransition(LIC, "Information Requested", "Under Review");
    assertAllowed(r, "Information Requested → Under Review");
  });

  it("sponsor cannot set any status to Licence Granted (role guard)", () => {
    const r = validateTransition(LIC, "Decision Pending", "Licence Granted", { roleId: 4 });
    assertBlocked(r, "sponsor → Licence Granted");
    assert.match(r.message, /administrator/i);
  });

  it("sponsor update stub — applies Under Review via FSM, not Pending", () => {
    // Mirrors the corrected updateLicenceApplication logic.
    function stubUpdateApplication(currentStatus) {
      const updateData = {};
      if (currentStatus === "Information Requested") {
        const check = validateTransition(LIC, "Information Requested", "Under Review");
        if (check.valid) updateData.status = "Under Review";
      }
      return updateData;
    }

    const result = stubUpdateApplication("Information Requested");
    assert.equal(result.status, "Under Review",
      "sponsor update must set Under Review, not Pending");
  });

  it("sponsor update on non-Information-Requested status does not change status", () => {
    function stubUpdateApplication(currentStatus) {
      const updateData = {};
      if (currentStatus === "Information Requested") {
        const check = validateTransition(LIC, "Information Requested", "Under Review");
        if (check.valid) updateData.status = "Under Review";
      }
      return updateData;
    }

    const result = stubUpdateApplication("Pending");
    assert.equal(result.status, undefined,
      "status must not be mutated when application is Pending");
  });
});

// ─── 4. licenceInformationRequest — closeInfoRequest FSM guard (ISSUE-015) ───

describe("licenceInformationRequest — closeInfoRequest FSM guard (ISSUE-015)", () => {
  // Inline stub mirrors the new closeInfoRequest auto-restart logic.
  function stubRestartReview(applicationStatus, remainingOpenRequests) {
    const events = [];
    if (remainingOpenRequests === 0 && applicationStatus === "Information Requested") {
      const check = validateTransition(LIC, applicationStatus, "Under Review");
      if (!check.valid) {
        events.push({ type: "error", message: check.message });
      } else {
        events.push({ type: "statusUpdate", newStatus: "Under Review" });
        events.push({ type: "audit", action: "REVIEW_RESTARTED" });
      }
    }
    return events;
  }

  it("restarts review via FSM when all requests closed and status is Information Requested", () => {
    const events = stubRestartReview("Information Requested", 0);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "statusUpdate");
    assert.equal(events[0].newStatus, "Under Review");
    assert.equal(events[1].type, "audit");
  });

  it("does NOT restart when there are still open requests", () => {
    const events = stubRestartReview("Information Requested", 1);
    assert.equal(events.length, 0);
  });

  it("does NOT restart when application status is not Information Requested", () => {
    const events = stubRestartReview("Under Review", 0);
    assert.equal(events.length, 0);
  });

  it("FSM validation for Information Requested → Under Review passes (no error path hit)", () => {
    const events = stubRestartReview("Information Requested", 0);
    const errorEvents = events.filter(e => e.type === "error");
    assert.equal(errorEvents.length, 0, "FSM must not reject the auto-restart transition");
  });

  it("Information Requested → Under Review is confirmed valid by the engine (direct check)", () => {
    const r = validateTransition(LIC, "Information Requested", "Under Review");
    assertAllowed(r, "Information Requested → Under Review (ISSUE-015 path)");
  });
});
