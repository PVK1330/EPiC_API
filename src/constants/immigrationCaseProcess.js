/**
 * Standard UK immigration case workflow (16 steps).
 * CCL fee approval / payment is tracked on CaseCclRecord while the case stays on client_care_letter.
 */
export const DEFAULT_CASE_STAGE = "client_enquiry";

/** Legacy 18-step ids → canonical 16-step id (read + migration). */
export const DEPRECATED_STAGE_TO_CANONICAL = {
  ccl_fee_proposal: "client_care_letter",
  ccl_fee_admin_review: "client_care_letter",
  ccl_issued: "client_care_letter",
  ccl_payment_received: "client_care_letter",
};

export const IMMIGRATION_CASE_STEPS = [
  {
    id: "client_enquiry",
    order: 1,
    title: "Client Enquiry",
    description: "Client contacts the firm with an immigration query.",
  },
  {
    id: "admin_assignment",
    order: 2,
    title: "Admin Assignment",
    description: "Admin reviews the enquiry, assigns a caseworker, and sets priority.",
  },
  {
    id: "initial_consultation",
    order: 3,
    title: "Initial Consultation",
    description: "Initial consultation to assess eligibility and visa options.",
  },
  {
    id: "data_capture_initial_docs",
    order: 4,
    title: "Data Capture & Documents",
    description:
      "Data Capture Sheet sent; passport, BRP/eVisa, and driving licence (if applicable) requested.",
  },
  {
    id: "application_preparation",
    order: 5,
    title: "Application Preparation",
    description: "Application form preparation begins once documents are received.",
  },
  {
    id: "document_review",
    order: 6,
    title: "Document Review",
    description: "Caseworker reviews documents and identifies gaps.",
  },
  {
    id: "further_information_request",
    order: 7,
    title: "Further Information",
    description: "Further information or documents requested from the client (optional).",
  },
  {
    id: "draft_application_review",
    order: 8,
    title: "Draft Application Review",
    description: "Draft application sent to the client for review and confirmation.",
  },
  {
    id: "client_care_letter",
    order: 9,
    title: "Client Care Letter",
    description:
      "CCL issued; candidate accepts and pays. Submission is blocked until both are complete.",
  },
  {
    id: "application_submitted",
    order: 10,
    title: "Application Submitted",
    description: "Final application submitted to the Home Office.",
  },
  {
    id: "biometrics_booked",
    order: 11,
    title: "Biometrics Booked",
    description: "Biometrics appointment is booked.",
  },
  {
    id: "biometrics_confirmation_sent",
    order: 12,
    title: "Confirmation Sent",
    description: "Biometrics confirmation and instructions sent to the client.",
  },
  {
    id: "documents_uploaded",
    order: 13,
    title: "Documents Uploaded",
    description: "Supporting documents uploaded before biometrics.",
  },
  {
    id: "awaiting_decision",
    order: 14,
    title: "Awaiting Decision",
    description: "Monitoring application while awaiting Home Office decision.",
  },
  {
    id: "decision_communicated",
    order: 15,
    title: "Decision Communicated",
    description: "Decision communicated to the client.",
  },
  {
    id: "case_closure",
    order: 16,
    title: "Case Closure",
    description: "Final case closure email issued.",
  },
];

const STEP_BY_ID = new Map(IMMIGRATION_CASE_STEPS.map((s) => [s.id, s]));

export const SUBMISSION_GATE_STAGE_ID = "application_submitted";

/** Map legacy `status` ENUM values to workflow step ids. */
export const LEGACY_STATUS_TO_STAGE = {
  Lead: "client_enquiry",
  Pending: "admin_assignment",
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

export const STAGE_TO_LEGACY_STATUS = {
  client_enquiry: "Lead",
  admin_assignment: "Pending",
  initial_consultation: "Pending",
  data_capture_initial_docs: "Docs Pending",
  application_preparation: "In Progress",
  document_review: "Under Review",
  further_information_request: "On Hold",
  draft_application_review: "Drafting",
  client_care_letter: "Drafting",
  application_submitted: "Submitted",
  biometrics_booked: "Submitted",
  biometrics_confirmation_sent: "Submitted",
  documents_uploaded: "Submitted",
  awaiting_decision: "Decision",
  decision_communicated: "Approved",
  case_closure: "Closed",
};

export function normalizeCaseStage(stageId) {
  if (!stageId) return null;
  return DEPRECATED_STAGE_TO_CANONICAL[stageId] ?? stageId;
}

export function isValidCaseStage(stageId) {
  return STEP_BY_ID.has(normalizeCaseStage(stageId));
}

export function getStepById(stageId) {
  return STEP_BY_ID.get(normalizeCaseStage(stageId)) ?? null;
}

export function resolveCaseStage(caseRecord) {
  const raw = caseRecord?.caseStage;
  if (raw) {
    const normalized = normalizeCaseStage(raw);
    if (STEP_BY_ID.has(normalized)) return normalized;
  }
  const fromStatus = LEGACY_STATUS_TO_STAGE[caseRecord?.status];
  if (fromStatus) return fromStatus;
  return DEFAULT_CASE_STAGE;
}

export function getStageOrder(stageId) {
  return getStepById(stageId)?.order ?? 0;
}

export function isAtOrPastSubmissionStage(stageId) {
  const order = getStageOrder(stageId);
  const gateOrder = getStageOrder(SUBMISSION_GATE_STAGE_ID);
  return order >= gateOrder && gateOrder > 0;
}

/**
 * Rule 1 — block pipeline moves at/after submission until CCL accepted and payment received.
 */
export async function assertSubmissionGate(tenantDb, caseRecord, nextStageId) {
  if (!isAtOrPastSubmissionStage(nextStageId)) {
    return { ok: true };
  }

  const ccl = await tenantDb.CaseCclRecord?.findOne({
    where: { caseId: caseRecord.id },
  });
  const cclIssued = Boolean(ccl?.issuedDocumentId || ccl?.issuedAt);
  const cclSigned =
    ccl &&
    (ccl.status === "signed" || ccl.status === "accepted") &&
    Boolean(ccl.signedDocumentId || ccl.signedAt);
  const cclOk = cclIssued && cclSigned;

  const total = Number(caseRecord.totalAmount) || 0;
  const paidAmt = Number(caseRecord.paidAmount) || 0;
  const amountStatus = String(caseRecord.amountStatus || "").toLowerCase();
  const paid =
    amountStatus === "paid" ||
    amountStatus === "partial" ||
    (total > 0 && paidAmt >= total) ||
    (total > 0 && paidAmt > 0);

  const failures = [];
  if (!cclOk) {
    failures.push("Client Care Letter must be uploaded and signed by the candidate");
  }
  if (!paid) {
    failures.push("case fees must be paid or partially paid before submission");
  }
  if (failures.length) {
    return {
      ok: false,
      message: `${failures.join("; ")}.`,
    };
  }
  return { ok: true };
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

export const STAGE_GUIDANCE = {
  client_enquiry: {
    actions: ["Review enquiry", "Assign caseworker"],
    docs: [],
  },
  admin_assignment: {
    actions: ["Confirm caseworker", "Set priority", "Start consultation"],
    docs: [],
  },
  initial_consultation: {
    actions: ["Assess eligibility", "Confirm visa route"],
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
    actions: ["Send draft to client", "Collect written approval", "Propose CCL fees"],
    docs: ["Draft application PDF"],
  },
  client_care_letter: {
    actions: [
      "Propose fees (caseworker)",
      "Approve fees & issue CCL (admin)",
      "Monitor acceptance and payment",
    ],
    docs: ["Client Care Letter", "Signed CCL", "Payment receipt"],
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
  return STAGE_GUIDANCE[normalizeCaseStage(stageId)] ?? { actions: [], docs: [] };
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
    {
      text: "Review your draft application and notify your caseworker of any changes",
      to: "/candidate/application",
    },
  ],
  client_care_letter: [
    { text: "Review and accept your Client Care Letter", to: "/candidate/ccl" },
    { text: "Pay your approved case fees", to: "/candidate/payments" },
  ],
  biometrics_booked: [
    { text: "Attend your biometrics appointment on the scheduled date", to: "/candidate/appointments" },
  ],
  documents_uploaded: [
    { text: "Ensure all supporting documents have been uploaded", to: "/candidate/upload-documents" },
  ],
  awaiting_decision: [
    { text: "No action needed — monitoring Home Office decision", calm: true },
  ],
  decision_communicated: [
    {
      text: "Download your decision letter from Application Pack",
      to: "/candidate/account?tab=downloads",
    },
  ],
  case_closure: [
    {
      text: "Download your final documents from Application Pack",
      to: "/candidate/account?tab=downloads",
    },
  ],
};

export function getCandidateStageActions(stageId) {
  const id = normalizeCaseStage(stageId);
  return (
    CANDIDATE_STAGE_ACTIONS[id] ?? [
      {
        text: "Your caseworker is handling this step — no action needed from you.",
        calm: true,
      },
    ]
  );
}
