/**
 * Week 6 Task 2: UKVI Decision Letter access page — unit tests.
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Document type matching (mirrors decisionLetter.controller.js) ─────────────
const DECISION_LETTER_TYPES = [
  "UKVI Decision Letter",
  "Decision Letter",
  "ukvi_decision_letter",
];

function isDecisionLetterDoc(documentType) {
  return DECISION_LETTER_TYPES.includes(documentType);
}

// ── Decision status logic (mirrors getDecisionStatus controller) ──────────────
const DECIDED_STATUSES = ["Approved", "Rejected", "Closed", "Decision"];

function buildDecisionSummary(caseRecord) {
  const hasDecision = DECIDED_STATUSES.includes(caseRecord.status);
  let approvalStatus = "pending";
  if (caseRecord.status === "Approved") approvalStatus = "approved";
  else if (caseRecord.status === "Rejected") approvalStatus = "rejected";
  return { ...caseRecord, hasDecision, approvalStatus };
}

// ── Download URL builder ──────────────────────────────────────────────────────
function buildDownloadUrl(docId) {
  return `/api/documents/${docId}/download`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Decision Letter — Document Type Recognition", () => {
  it("recognises 'UKVI Decision Letter'", () => {
    assert.ok(isDecisionLetterDoc("UKVI Decision Letter"));
  });

  it("recognises 'Decision Letter'", () => {
    assert.ok(isDecisionLetterDoc("Decision Letter"));
  });

  it("recognises lowercase 'ukvi_decision_letter'", () => {
    assert.ok(isDecisionLetterDoc("ukvi_decision_letter"));
  });

  it("does not recognise 'Passport'", () => {
    assert.ok(!isDecisionLetterDoc("Passport"));
  });

  it("does not recognise 'BRP'", () => {
    assert.ok(!isDecisionLetterDoc("BRP"));
  });

  it("does not recognise empty string", () => {
    assert.ok(!isDecisionLetterDoc(""));
  });

  it("exactly 3 recognised decision letter types", () => {
    assert.equal(DECISION_LETTER_TYPES.length, 3);
  });
});

describe("Decision Letter — Case Decision Status", () => {
  it("Approved case has hasDecision=true and approvalStatus=approved", () => {
    const result = buildDecisionSummary({ caseId: "CAS-001", status: "Approved" });
    assert.ok(result.hasDecision);
    assert.equal(result.approvalStatus, "approved");
  });

  it("Rejected case has hasDecision=true and approvalStatus=rejected", () => {
    const result = buildDecisionSummary({ caseId: "CAS-002", status: "Rejected" });
    assert.ok(result.hasDecision);
    assert.equal(result.approvalStatus, "rejected");
  });

  it("Closed case has hasDecision=true and approvalStatus=pending", () => {
    const result = buildDecisionSummary({ caseId: "CAS-003", status: "Closed" });
    assert.ok(result.hasDecision);
    assert.equal(result.approvalStatus, "pending");
  });

  it("Decision status has hasDecision=true", () => {
    const result = buildDecisionSummary({ caseId: "CAS-004", status: "Decision" });
    assert.ok(result.hasDecision);
  });

  it("In Progress case has hasDecision=false", () => {
    const result = buildDecisionSummary({ caseId: "CAS-005", status: "In Progress" });
    assert.ok(!result.hasDecision);
    assert.equal(result.approvalStatus, "pending");
  });

  it("Pending case has hasDecision=false", () => {
    const result = buildDecisionSummary({ caseId: "CAS-006", status: "Pending" });
    assert.ok(!result.hasDecision);
  });

  it("Lead case has hasDecision=false", () => {
    const result = buildDecisionSummary({ caseId: "CAS-007", status: "Lead" });
    assert.ok(!result.hasDecision);
  });
});

describe("Decision Letter — Download URL", () => {
  it("builds correct download URL for a document", () => {
    assert.equal(buildDownloadUrl(42), "/api/documents/42/download");
  });

  it("different document ids produce different URLs", () => {
    assert.notEqual(buildDownloadUrl(1), buildDownloadUrl(2));
  });

  it("URL contains the document id", () => {
    const url = buildDownloadUrl(99);
    assert.ok(url.includes("99"), "URL should include doc id");
  });
});

describe("Decision Letter — Filtering Documents by Case", () => {
  const docs = [
    { id: 1, caseId: 10, documentType: "UKVI Decision Letter" },
    { id: 2, caseId: 10, documentType: "Passport" },
    { id: 3, caseId: 11, documentType: "Decision Letter" },
    { id: 4, caseId: 12, documentType: "ukvi_decision_letter" },
  ];

  it("filters only decision letter docs from a mixed list", () => {
    const result = docs.filter((d) => isDecisionLetterDoc(d.documentType));
    assert.equal(result.length, 3);
  });

  it("filtered docs all have decision letter document types", () => {
    const result = docs.filter((d) => isDecisionLetterDoc(d.documentType));
    result.forEach((d) => assert.ok(isDecisionLetterDoc(d.documentType)));
  });

  it("Passport document is excluded from results", () => {
    const result = docs.filter((d) => isDecisionLetterDoc(d.documentType));
    assert.ok(!result.some((d) => d.documentType === "Passport"));
  });
});
