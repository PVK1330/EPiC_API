/**
 * Standard UK immigration case workflow (18 steps).
 * Used for pipeline Kanban, caseStage field, and caseworker guidance.
 */
export const DEFAULT_CASE_STAGE = "client_enquiry";

export const IMMIGRATION_CASE_STEPS = [
  {
    id: "client_enquiry",
    order: 1,
    title: "Client Enquiry",
    description:
      "Client contacts the firm with an immigration query.",
  },
  {
    id: "initial_consultation",
    order: 2,
    title: "Initial Consultation",
    description:
      "Initial consultation is conducted to assess eligibility and visa options.",
  },
  {
    id: "data_capture_initial_docs",
    order: 3,
    title: "Data Capture & Initial Documents",
    description:
      "Relevant Data Capture Sheet sent for the visa category. Initial mandatory documents requested: Passport, BRP/eVisa, Driving licence (if applicable).",
  },
  {
    id: "application_preparation",
    order: 4,
    title: "Application Preparation",
    description:
      "Once documents and Data Capture Sheet are received, application form preparation begins.",
  },
  {
    id: "document_review",
    order: 5,
    title: "Document Review",
    description:
      "Caseworker reviews documents and identifies missing information or additional documents required.",
  },
  {
    id: "further_information_request",
    order: 6,
    title: "Further Information Request",
    description:
      "Further information or documents are requested from the client where necessary.",
  },
  {
    id: "draft_application_review",
    order: 7,
    title: "Draft Application Review",
    description:
      "Draft application form prepared and sent to the client for review and confirmation.",
  },
  {
    id: "ccl_fee_proposal",
    order: 8,
    title: "CCL Fee Proposal",
    description:
      "Caseworker proposes total fees and instalment schedule for admin review.",
  },
  {
    id: "ccl_fee_admin_review",
    order: 9,
    title: "CCL Fee — Admin Review",
    description:
      "Admin reviews and approves fees and instalments before the CCL is sent to the client.",
  },
  {
    id: "ccl_issued",
    order: 10,
    title: "Client Care Letter Issued",
    description:
      "Approved Client Care Letter and fee schedule sent to the client for acceptance.",
  },
  {
    id: "ccl_payment_received",
    order: 11,
    title: "CCL & Payment Received",
    description:
      "Signed Client Care Letter and required payments are received from the client.",
  },
  {
    id: "application_submitted",
    order: 12,
    title: "Application Submitted",
    description:
      "Final application is submitted to the Home Office.",
  },
  {
    id: "biometrics_booked",
    order: 13,
    title: "Biometrics Booked",
    description:
      "Biometrics appointment is booked.",
  },
  {
    id: "biometrics_confirmation_sent",
    order: 14,
    title: "Biometrics Confirmation Sent",
    description:
      "Biometrics appointment confirmation email and instructions are sent to the client.",
  },
  {
    id: "documents_uploaded",
    order: 15,
    title: "Documents Uploaded",
    description:
      "Supporting documents are uploaded prior to the biometrics appointment.",
  },
  {
    id: "awaiting_decision",
    order: 16,
    title: "Awaiting Decision",
    description:
      "Application status is monitored while awaiting Home Office decision.",
  },
  {
    id: "decision_communicated",
    order: 17,
    title: "Decision Communicated",
    description:
      "Approval or refusal email and decision documents are sent to the client.",
  },
  {
    id: "case_closure",
    order: 18,
    title: "Case Closure",
    description:
      "Final case closure email is issued.",
  },
];

const STEP_BY_ID = new Map(IMMIGRATION_CASE_STEPS.map((s) => [s.id, s]));

/** Map legacy `status` ENUM values to workflow step ids. */
export const LEGACY_STATUS_TO_STAGE = {
  Lead: "client_enquiry",
  Pending: "initial_consultation",
  "In Progress": "application_preparation",
  "Docs Pending": "data_capture_initial_docs",
  Drafting: "draft_application_review",
  "Under Review": "document_review",
  Submitted: "application_submitted",
  Decision: "awaiting_decision",
  Approved: "decision_communicated",
  Rejected: "decision_communicated",
  Completed: "case_closure",
  Closed: "case_closure",
  "On Hold": "further_information_request",
  Cancelled: "case_closure",
  Overdue: "awaiting_decision",
};

/** Approximate legacy status for filters/reporting when only caseStage is updated. */
export const STAGE_TO_LEGACY_STATUS = {
  client_enquiry: "Lead",
  initial_consultation: "Pending",
  data_capture_initial_docs: "Docs Pending",
  application_preparation: "In Progress",
  document_review: "Under Review",
  further_information_request: "On Hold",
  draft_application_review: "Drafting",
  ccl_fee_proposal: "Drafting",
  ccl_fee_admin_review: "Drafting",
  ccl_issued: "Drafting",
  ccl_payment_received: "Pending",
  application_submitted: "Submitted",
  biometrics_booked: "Submitted",
  biometrics_confirmation_sent: "Submitted",
  documents_uploaded: "Submitted",
  awaiting_decision: "Decision",
  decision_communicated: "Approved",
  case_closure: "Closed",
};

export function isValidCaseStage(stageId) {
  return STEP_BY_ID.has(stageId);
}

export function getStepById(stageId) {
  return STEP_BY_ID.get(stageId) ?? null;
}

export function resolveCaseStage(caseRecord) {
  if (caseRecord?.caseStage && isValidCaseStage(caseRecord.caseStage)) {
    return caseRecord.caseStage;
  }
  const fromStatus = LEGACY_STATUS_TO_STAGE[caseRecord?.status];
  if (fromStatus) return fromStatus;
  return DEFAULT_CASE_STAGE;
}

export function buildEmptyPipeline() {
  const pipeline = {};
  for (const step of IMMIGRATION_CASE_STEPS) {
    pipeline[step.id] = [];
  }
  return pipeline;
}

export function assignCasesToPipeline(cases = []) {
  const pipeline = buildEmptyPipeline();
  for (const c of cases) {
    const stageId = resolveCaseStage(c);
    pipeline[stageId].push(c);
  }
  return pipeline;
}

/** Per-step caseworker actions and documents (Standard Immigration Case Process.docx). */
export const STAGE_GUIDANCE = {
  client_enquiry: {
    actions: ["Log enquiry", "Assign caseworker", "Schedule consultation"],
    docs: [],
  },
  initial_consultation: {
    actions: ["Assess eligibility", "Confirm visa route", "Send fee estimate"],
    docs: [],
  },
  data_capture_initial_docs: {
    actions: ["Send Data Capture Sheet", "Request mandatory documents"],
    docs: ["Passport", "BRP / eVisa", "Driving licence (if applicable)"],
  },
  application_preparation: {
    actions: ["Begin application form", "Verify Data Capture Sheet received"],
    docs: ["Completed Data Capture Sheet"],
  },
  document_review: {
    actions: ["Review uploads", "Flag gaps", "Internal QC"],
    docs: ["All mandatory documents"],
  },
  further_information_request: {
    actions: ["Email client for missing items", "Set follow-up date"],
    docs: ["As identified in review"],
  },
  draft_application_review: {
    actions: ["Send draft to client", "Collect written approval", "Propose CCL fees & instalments"],
    docs: ["Draft application PDF"],
  },
  ccl_fee_proposal: {
    actions: ["Set total fee", "Define instalment schedule", "Submit to admin for approval"],
    docs: ["Fee breakdown", "Instalment plan"],
  },
  ccl_fee_admin_review: {
    actions: ["Review proposed fees", "Approve or return to caseworker", "Release CCL to client when approved"],
    docs: ["Proposed fee schedule"],
  },
  ccl_issued: {
    actions: ["Monitor client acceptance", "Track instalment payments"],
    docs: ["Client Care Letter (issued to client)"],
  },
  ccl_payment_received: {
    actions: ["Collect signed CCL", "Confirm payment cleared"],
    docs: ["Signed CCL", "Payment receipt"],
  },
  application_submitted: {
    actions: ["Submit to Home Office", "Record UAN / reference"],
    docs: ["Submission confirmation"],
  },
  biometrics_booked: {
    actions: ["Book appointment", "Add to case calendar"],
    docs: ["Appointment letter"],
  },
  biometrics_confirmation_sent: {
    actions: ["Email client instructions", "Confirm attendance"],
    docs: ["Biometrics confirmation email"],
  },
  documents_uploaded: {
    actions: ["Upload supporting docs", "Pre-biometrics checklist"],
    docs: ["Supporting evidence bundle"],
  },
  awaiting_decision: {
    actions: ["Monitor Home Office status", "Log correspondence"],
    docs: [],
  },
  decision_communicated: {
    actions: ["Send decision email", "Attach decision documents"],
    docs: ["Approval or refusal letter"],
  },
  case_closure: {
    actions: ["Send case closure email", "Archive case file"],
    docs: [],
  },
};

export function getStageGuidance(stageId) {
  return STAGE_GUIDANCE[stageId] ?? { actions: [], docs: [] };
}

export function getNextStageId(stageId) {
  const step = getStepById(stageId);
  if (!step || step.order >= IMMIGRATION_CASE_STEPS.length) return null;
  return IMMIGRATION_CASE_STEPS[step.order]?.id ?? null;
}

export const CANDIDATE_STAGE_ACTIONS = {
  data_capture_initial_docs: [
    { text: "Complete your Data Capture Sheet", to: "/candidate/data-capture-sheet" },
    { text: "Upload: Passport, BRP/eVisa", to: "/candidate/document-checklist" },
  ],
  draft_application_review: [
    { text: "Review your draft application and notify your caseworker of any changes", to: "/candidate/application" },
  ],
  ccl_issued: [
    { text: "Review and accept your Client Care Letter", to: "/candidate/ccl" },
    { text: "Pay your approved case fees", to: "/candidate/payments" },
  ],
  ccl_payment_received: [{ text: "Ensure your payment has been received", to: "/candidate/payments" }],
  biometrics_booked: [{ text: "Attend your biometrics appointment on the scheduled date", to: "/candidate/appointments" }],
  documents_uploaded: [{ text: "Ensure all supporting documents have been uploaded", to: "/candidate/upload-documents" }],
  awaiting_decision: [{ text: "No action needed — monitoring Home Office decision", calm: true }],
  decision_communicated: [{ text: "Download your decision letter from Application Pack", to: "/candidate/account?tab=downloads" }],
  case_closure: [{ text: "Download your final documents from Application Pack", to: "/candidate/account?tab=downloads" }],
};

export function getCandidateStageActions(stageId) {
  return CANDIDATE_STAGE_ACTIONS[stageId] ?? [
    { text: "Your caseworker is handling this step — no action needed from you.", calm: true },
  ];
}
