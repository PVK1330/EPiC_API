/**
 * Candidate-visible steps for CCL fee approval and letter release.
 * Built from CaseCclRecord + case amountStatus (no internal timeline queries).
 */
export function buildCandidateCclApprovalTimeline(ccl, caseRecord) {
  const steps = [];
  if (!ccl && !caseRecord) return steps;

  const cclStatus = String(ccl?.status || "").toLowerCase();
  const amountStatus = String(caseRecord?.amountStatus || "").trim();
  const fee = Number(ccl?.feeAmount) || Number(caseRecord?.totalAmount) || 0;

  const hasProposal =
    ccl?.proposedAt ||
    ["fee_proposed", "fee_rejected", "issued", "signed", "accepted"].includes(cclStatus);

  if (hasProposal) {
    steps.push({
      id: "proposed",
      label: "Fee proposal submitted",
      status: "completed",
      at: ccl?.proposedAt || null,
      detail: fee > 0 ? `Total fee £${fee.toFixed(2)}` : null,
    });
  }

  if (cclStatus === "fee_rejected") {
    steps.push({
      id: "admin_review",
      label: "Fee proposal returned",
      status: "rejected",
      at: ccl?.adminReviewedAt || null,
      detail: ccl?.adminReviewNotes || "Returned to your caseworker for revision",
    });
  } else if (cclStatus === "fee_proposed" && amountStatus === "Pending Approval") {
    steps.push({
      id: "admin_review",
      label: "Awaiting firm approval",
      status: "in_progress",
      at: null,
      detail: "An administrator is reviewing your fee schedule",
    });
  } else if (
    ccl?.adminReviewedAt ||
    amountStatus === "Approved" ||
    amountStatus === "Paid" ||
    ["issued", "signed", "accepted"].includes(cclStatus)
  ) {
    steps.push({
      id: "admin_review",
      label: "Fee schedule approved",
      status: "completed",
      at: ccl?.adminReviewedAt || ccl?.issuedAt || null,
      detail: ccl?.adminReviewNotes || null,
    });
  }

  if (ccl?.issuedAt || ["issued", "signed", "accepted"].includes(cclStatus)) {
    steps.push({
      id: "issued",
      label: "Client Care Letter released",
      status: "completed",
      at: ccl?.issuedAt || null,
      detail: null,
    });
  }

  if (ccl?.signedAt || ["signed", "accepted"].includes(cclStatus)) {
    steps.push({
      id: "accepted",
      label: "Accepted by you",
      status: "completed",
      at: ccl?.signedAt || null,
      detail: null,
    });
  }

  return steps;
}
