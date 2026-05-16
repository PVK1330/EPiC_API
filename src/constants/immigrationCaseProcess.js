/**
 * Standard UK immigration case workflow (16 steps).
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
    id: "ccl_issued",
    order: 8,
    title: "Client Care Letter Issued",
    description:
      "After client approval of the draft application, the Client Care Letter (CCL) is issued.",
  },
  {
    id: "ccl_payment_received",
    order: 9,
    title: "CCL & Payment Received",
    description:
      "Signed Client Care Letter and required payments are received from the client.",
  },
  {
    id: "application_submitted",
    order: 10,
    title: "Application Submitted",
    description:
      "Final application is submitted to the Home Office.",
  },
  {
    id: "biometrics_booked",
    order: 11,
    title: "Biometrics Booked",
    description:
      "Biometrics appointment is booked.",
  },
  {
    id: "biometrics_confirmation_sent",
    order: 12,
    title: "Biometrics Confirmation Sent",
    description:
      "Biometrics appointment confirmation email and instructions are sent to the client.",
  },
  {
    id: "documents_uploaded",
    order: 13,
    title: "Documents Uploaded",
    description:
      "Supporting documents are uploaded prior to the biometrics appointment.",
  },
  {
    id: "awaiting_decision",
    order: 14,
    title: "Awaiting Decision",
    description:
      "Application status is monitored while awaiting Home Office decision.",
  },
  {
    id: "decision_communicated",
    order: 15,
    title: "Decision Communicated",
    description:
      "Approval or refusal email and decision documents are sent to the client.",
  },
  {
    id: "case_closure",
    order: 16,
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
