import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CASE_STAGE,
  IMMIGRATION_CASE_STEPS,
  SUBMISSION_GATE_STAGE_ID,
  normalizeCaseStage,
  isValidCaseStage,
  getStepById,
  resolveCaseStage,
  getStageOrder,
  isAtOrPastSubmissionStage,
  isCaseFeeSatisfied,
  assertSubmissionGate,
  buildEmptyPipeline,
  assignCasesToPipeline,
  getNextStageId,
  getCandidateStageActions,
  LEGACY_STATUS_TO_STAGE,
  STAGE_TO_LEGACY_STATUS,
} from "../src/constants/immigrationCaseProcess.js";

// ── Stage catalogue ───────────────────────────────────────────────────────────
test("16-step immigration flow is defined with sequential order", () => {
  assert.equal(IMMIGRATION_CASE_STEPS.length, 16);
  IMMIGRATION_CASE_STEPS.forEach((s, i) => assert.equal(s.order, i + 1));
  assert.equal(DEFAULT_CASE_STAGE, "client_enquiry");
  assert.equal(SUBMISSION_GATE_STAGE_ID, "application_submitted");
});

// ── Stage normalisation / validity ────────────────────────────────────────────
test("legacy CCL stage ids normalise to the canonical client_care_letter", () => {
  assert.equal(normalizeCaseStage("ccl_fee_proposal"), "client_care_letter");
  assert.equal(normalizeCaseStage("ccl_issued"), "client_care_letter");
  assert.equal(normalizeCaseStage("document_review"), "document_review");
  assert.equal(normalizeCaseStage(null), null);
});

test("isValidCaseStage accepts known stages and rejects unknown", () => {
  assert.equal(isValidCaseStage("document_review"), true);
  assert.equal(isValidCaseStage("ccl_issued"), true); // deprecated → canonical
  assert.equal(isValidCaseStage("not_a_stage"), false);
});

test("getStepById returns the step with its order", () => {
  assert.equal(getStepById("client_enquiry").order, 1);
  assert.equal(getStepById("case_closure").order, 16);
  assert.equal(getStepById("nope"), null);
});

// ── Stage resolution from a case record ───────────────────────────────────────
test("resolveCaseStage prefers caseStage, falls back to legacy status, then default", () => {
  assert.equal(resolveCaseStage({ caseStage: "document_review" }), "document_review");
  assert.equal(resolveCaseStage({ status: "Submitted" }), "application_submitted");
  assert.equal(resolveCaseStage({}), "client_enquiry");
  assert.equal(resolveCaseStage(null), "client_enquiry");
});

// ── Submission gate ordering ──────────────────────────────────────────────────
test("isAtOrPastSubmissionStage gates everything from application_submitted onward", () => {
  assert.equal(getStageOrder("application_submitted"), 10);
  assert.equal(isAtOrPastSubmissionStage("client_care_letter"), false); // order 9
  assert.equal(isAtOrPastSubmissionStage("application_submitted"), true);
  assert.equal(isAtOrPastSubmissionStage("case_closure"), true);
});

test("getNextStageId walks the flow and stops at the end", () => {
  assert.equal(getNextStageId("client_enquiry"), "admin_assignment");
  assert.equal(getNextStageId("awaiting_decision"), "decision_communicated");
  assert.equal(getNextStageId("case_closure"), null);
});

// ── Fee satisfaction ──────────────────────────────────────────────────────────
test("isCaseFeeSatisfied recognises approved/paid/partial and amounts", () => {
  assert.equal(isCaseFeeSatisfied({ amountStatus: "Approved" }), true);
  assert.equal(isCaseFeeSatisfied({ amountStatus: "paid" }), true);
  assert.equal(isCaseFeeSatisfied({ amountStatus: "partial" }), true);
  assert.equal(isCaseFeeSatisfied({ totalAmount: 100, paidAmount: 100 }), true);
  assert.equal(isCaseFeeSatisfied({ totalAmount: 100, paidAmount: 30 }), true); // partial pay
  assert.equal(isCaseFeeSatisfied({ totalAmount: 100, paidAmount: 0, amountStatus: "pending" }), false);
  assert.equal(isCaseFeeSatisfied({}), false);
});

// ── Submission gate (CCL signed + fee paid) ───────────────────────────────────
test("assertSubmissionGate passes for pre-submission stages without checks", async () => {
  const tenantDb = { CaseCclRecord: { findOne: async () => null } };
  const res = await assertSubmissionGate(tenantDb, { id: 1 }, "document_review");
  assert.equal(res.ok, true);
});

test("assertSubmissionGate blocks submission until CCL signed AND fee paid", async () => {
  // No CCL, no payment → blocked
  const noCcl = { CaseCclRecord: { findOne: async () => null } };
  const blocked = await assertSubmissionGate(noCcl, { id: 1, totalAmount: 0 }, "application_submitted");
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /Client Care Letter/i);

  // CCL issued + signed AND fee paid → allowed
  const signedCcl = {
    CaseCclRecord: {
      findOne: async () => ({
        caseId: 1,
        issuedDocumentId: 10,
        issuedAt: new Date(),
        status: "signed",
        signedDocumentId: 11,
        signedAt: new Date(),
      }),
    },
  };
  const allowed = await assertSubmissionGate(
    signedCcl,
    { id: 1, amountStatus: "paid" },
    "application_submitted",
  );
  assert.equal(allowed.ok, true);
});

// ── Pipeline bucketing ────────────────────────────────────────────────────────
test("buildEmptyPipeline / assignCasesToPipeline bucket cases by resolved stage", () => {
  const empty = buildEmptyPipeline();
  assert.equal(Object.keys(empty).length, 16);
  assert.deepEqual(empty.client_enquiry, []);

  const pipeline = assignCasesToPipeline([
    { id: 1, caseStage: "client_enquiry" },
    { id: 2, status: "Submitted" }, // → application_submitted
    { id: 3, caseStage: "case_closure" },
  ]);
  assert.equal(pipeline.client_enquiry.length, 1);
  assert.equal(pipeline.application_submitted.length, 1);
  assert.equal(pipeline.case_closure.length, 1);
});

// ── Legacy status mapping round-trips ─────────────────────────────────────────
test("legacy status ⇄ stage maps are consistent for key stages", () => {
  assert.equal(LEGACY_STATUS_TO_STAGE.Submitted, "application_submitted");
  assert.equal(LEGACY_STATUS_TO_STAGE.Closed, "case_closure");
  assert.equal(STAGE_TO_LEGACY_STATUS.application_submitted, "Submitted");
  assert.equal(STAGE_TO_LEGACY_STATUS.case_closure, "Closed");
});

// ── Candidate stage actions ───────────────────────────────────────────────────
test("getCandidateStageActions returns calm guidance while awaiting decision", () => {
  const actions = getCandidateStageActions("awaiting_decision");
  assert.ok(Array.isArray(actions) && actions.length > 0);
  assert.equal(actions[0].calm, true);

  // Unknown stage → safe default
  const fallback = getCandidateStageActions("???");
  assert.ok(Array.isArray(fallback) && fallback[0].calm === true);
});
