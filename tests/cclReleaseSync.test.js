import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the candidate /api/workflow/payments/schedule (and /ccl, and
// Stripe checkout) 500: "Invalid transition from 'data_capture_initial_docs' to
// 'client_care_letter'". When fees are approved on a case still sitting at an
// early stage, releasing the CCL must NOT be blocked by the strict workflow FSM
// refusing the cosmetic case-stage advance. Mock the stage-change service to
// throw exactly as the FSM would, and assert the sync swallows it.
mock.module("../src/services/caseStageAutomation.service.js", {
  namedExports: {
    applyCaseStageChange: mock.fn(async () => {
      throw new Error(
        "State Transition Error: Invalid transition from 'data_capture_initial_docs' to 'client_care_letter'. Allowed: application_preparation, further_information_request, case_closure",
      );
    }),
  },
});

mock.module("../src/services/cclTemplate.service.js", {
  namedExports: {
    attachCclTemplateToCase: mock.fn(async () => {}),
    isCclStageVisibleToCandidate: mock.fn(() => false),
    CCL_VISIBLE_MIN_ORDER: 9,
  },
});

const { syncCclReleaseForApprovedFees } = await import("../src/services/cclCandidateRelease.service.js");

function makeCaseRecord() {
  return {
    id: 101,
    caseStage: "data_capture_initial_docs",
    status: "In Progress",
    amountStatus: "Approved", // admin approved the fees
    totalAmount: 0, // not yet mirrored onto the case row
    proposedAmount: 1500, // admin CCL fee
    async update(patch) {
      Object.assign(this, patch);
    },
    async reload() {},
  };
}

function makeTenantDb(cclRow) {
  return {
    CaseCclRecord: {
      findOne: mock.fn(async () => cclRow),
      findOrCreate: mock.fn(async ({ defaults }) => {
        const row = {
          status: defaults.status,
          feeAmount: defaults.feeAmount,
          installmentPlan: defaults.installmentPlan,
          issuedAt: defaults.issuedAt,
          issuedBy: defaults.issuedBy,
          issuedDocumentId: null,
          async update(patch) {
            Object.assign(this, patch);
          },
          async reload() {},
        };
        return [row, true];
      }),
    },
  };
}

describe("syncCclReleaseForApprovedFees — FSM transition resilience", () => {
  it("releases the CCL without throwing when the case stage cannot advance", async () => {
    const tenantDb = makeTenantDb(null);
    const caseRecord = makeCaseRecord();

    // Must NOT throw even though applyCaseStageChange rejects the transition.
    const result = await syncCclReleaseForApprovedFees({ tenantDb, caseRecord, performedBy: 7 });

    assert.ok(result, "should return a result");
    assert.equal(result.synced, true);
    // CCL was released to the client via the record (issued) + case fee mirrored.
    assert.equal(result.ccl.status, "issued");
    assert.equal(caseRecord.totalAmount, 1500);
  });

  it("does nothing (no throw) when fees are not approved", async () => {
    const tenantDb = makeTenantDb(null);
    const caseRecord = makeCaseRecord();
    caseRecord.amountStatus = "Pending";

    const result = await syncCclReleaseForApprovedFees({ tenantDb, caseRecord, performedBy: 7 });
    assert.equal(result.synced, false);
  });
});
