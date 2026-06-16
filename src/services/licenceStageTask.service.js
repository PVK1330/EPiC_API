import logger from "../utils/logger.js";
import { ROLES } from "../middlewares/role.middleware.js";
import { deliver } from "./sponsorshipNotification.service.js";
import { NotificationTypes, NotificationPriority } from "./notification.service.js";
import { extractCaseworkerIds } from "./licenceAssignment.service.js";
import { loadFullApplication, serializeApplication } from "./licenceApplicationV2.service.js";

/**
 * Licence Stage Task engine.
 *
 * Owns the dynamic, per-stage, per-role task assignments behind the Sponsor
 * Licence "stages" panel. Responsibilities:
 *   - Idempotently SEED a task row for every (stage, role) of an application.
 *   - RESOLVE the responsible person for each role (sponsor=owner, caseworker=
 *     assigned, admin=tenant admin, candidate=CoS contact).
 *   - INFER which stages are already complete from the application's own data.
 *   - COMPLETE a task on behalf of a role and NOTIFY (in-app + email) the parties
 *     who need to know, recording an audit entry.
 *
 * The 10 stage definitions mirror the frontend (constants/licenceStages.js) so
 * the panel and the engine never drift.
 */

export const STAGE_ROLE_KEYS = ["sponsor", "caseworker", "admin", "candidate"];

export const LICENCE_STAGE_DEFINITIONS = [
  {
    key: "enquiry_onboarding", order: 1, title: "Enquiry & Onboarding", govSection: "Intake",
    tasks: {
      sponsor: "Submit a sponsor licence enquiry with basic business details.",
      caseworker: "Acknowledge the assignment and schedule an introductory call.",
      admin: "Triage the enquiry, open the application, and assign a caseworker.",
      candidate: "Register interest as a prospective sponsored worker.",
    },
  },
  {
    key: "licence_routes", order: 2, title: "Licence Routes", govSection: "Section 1",
    tasks: {
      sponsor: "Select the route(s) and declare any existing sponsor licence number (SLN).",
      caseworker: "Advise on the correct route and confirm eligibility.",
      admin: "Verify the selected routes are recorded against the application.",
      candidate: "Confirm the role and route they would be sponsored under.",
    },
  },
  {
    key: "organisation_details", order: 3, title: "Organisation Details", govSection: "Section 2",
    tasks: {
      sponsor: "Provide organisation details, trading names, Companies House number and HMRC/PAYE references.",
      caseworker: "Verify the details against Companies House and HMRC records.",
      admin: "QA the captured organisation profile for completeness.",
      candidate: null,
    },
  },
  {
    key: "cos_requirements", order: 4, title: "CoS & CAS Requirements", govSection: "Section 3",
    tasks: {
      sponsor: "State the number of CoS required and provide detailed justification.",
      caseworker: "Validate the SOC code, salary threshold and genuine vacancy.",
      admin: "Approve the requested CoS allocation.",
      candidate: "Provide role/salary details and current immigration status (e.g. Graduate Route expiry).",
    },
  },
  {
    key: "supporting_documents", order: 5, title: "Supporting Documents", govSection: "Section 4",
    tasks: {
      sponsor: "Upload the required Appendix A documents.",
      caseworker: "Review each document and request any missing evidence.",
      admin: "Sign off the document pack as complete.",
      candidate: "Provide personal documents (passport, current visa / BRP).",
    },
  },
  {
    key: "key_personnel", order: 6, title: "Key Personnel & Convictions", govSection: "Section 5",
    tasks: {
      sponsor: "Nominate the Authorising Officer, Key Contact and Level 1 User; declare any convictions.",
      caseworker: "Verify personnel are UK-based, hold an NI number and have a clean record.",
      admin: "Approve the key personnel appointments.",
      candidate: null,
    },
  },
  {
    key: "declarations", order: 7, title: "Declarations & Representative", govSection: "Section 6",
    tasks: {
      sponsor: "Confirm the application is true and authorise the representative.",
      caseworker: "Complete the representative / OISC declaration.",
      admin: "Counter-sign and approve the declarations.",
      candidate: null,
    },
  },
  {
    key: "payment", order: 8, title: "Payment", govSection: "Section 7",
    tasks: {
      sponsor: "Pay the licence fee based on the sponsor size.",
      caseworker: "Verify the payment has cleared before submission.",
      admin: "Record the payment and issue a receipt.",
      candidate: null,
    },
  },
  // ── Intake: dedicated information & document collection (orders 9-10) ──────
  {
    key: "intake_information_form", order: 9, title: "Sponsor Information Form", govSection: "Intake",
    tasks: {
      sponsor: "Complete the 12-field Sponsor Information Form: trading name, premises address, named person on licence, NI number, employee counts, CoS required, and more.",
      caseworker: "Review the completed information form for accuracy and completeness before progressing to document verification.",
      admin: "Confirm the information form has been reviewed and approved by the caseworker.",
      candidate: null,
    },
  },
  {
    key: "intake_document_checklist", order: 10, title: "Document Collection & Verification", govSection: "Intake",
    tasks: {
      sponsor: "Upload all mandatory documents (Employer's Liability Insurance, Certificate of Incorporation, PAYE registration, bank statements, premises evidence, and identity documents). Toggle additional document requirements if applicable (food/alcohol/care business, TUPE, candidate).",
      caseworker: "Verify each uploaded document meets the Home Office requirements. Reject or request further information where needed. All mandatory documents must reach 'Verified' status before Government Registration can proceed.",
      admin: "Confirm all mandatory documents have been verified and the intake stage is complete.",
      candidate: null,
    },
  },
  // ── Phase 2: Government processing pipeline stages (orders 11-16) ─────────
  {
    key: "sponsor_information_provision", order: 11, title: "Sponsor Information Provision", govSection: "Government Prep",
    tasks: {
      sponsor: "Confirm all organisational details, personnel, and documents are accurate and up-to-date before portal submission.",
      caseworker: "Validate completeness of the sponsor's information pack and confirm readiness for government portal entry.",
      admin: "Authorise the information pack for government portal submission.",
      candidate: null,
    },
  },
  {
    key: "government_sms_registration", order: 12, title: "Government SMS Registration", govSection: "Government Prep",
    tasks: {
      sponsor: "Await confirmation that your organisation has been registered on the UKVI Sponsorship Management System (SMS).",
      caseworker: "Register the sponsor organisation on the SMS portal and obtain the SMS portal username and registration reference.",
      admin: "Verify the SMS registration details and record the reference number.",
      candidate: null,
    },
  },
  {
    key: "sponsor_portal_onboarding", order: 13, title: "Sponsor Portal Onboarding", govSection: "Government Prep",
    tasks: {
      sponsor: "Log in to the UKVI Sponsor Management System using the credentials provided and confirm access.",
      caseworker: "Guide the sponsor through the SMS portal login and confirm the sponsor can access their account.",
      admin: "Record that the sponsor has been successfully onboarded to the SMS portal.",
      candidate: null,
    },
  },
  {
    key: "government_portal_credentials", order: 14, title: "Government Portal Credentials", govSection: "Government Application",
    tasks: {
      sponsor: "Receive and confirm receipt of the UKVI online application portal credentials.",
      caseworker: "Generate the UKVI online application portal user ID and password; share securely with the sponsor.",
      admin: "Confirm credentials have been generated and securely transmitted.",
      candidate: null,
    },
  },
  {
    key: "government_application_forms", order: 15, title: "Government Application Forms", govSection: "Government Application",
    tasks: {
      sponsor: "Log in to the UKVI portal and complete the online sponsor licence application forms.",
      caseworker: "Review and verify all form entries with the sponsor; ensure declarations and supporting data are correctly entered.",
      admin: "Carry out a final QA check of the completed government application forms before submission.",
      candidate: null,
    },
  },
  {
    key: "government_submission", order: 16, title: "Government Submission", govSection: "Government Application",
    tasks: {
      sponsor: "Confirm submission of the online application to UKVI and note the government submission reference number.",
      caseworker: "Submit the completed online application form to UKVI and record the submission reference and date.",
      admin: "Record the government submission reference, date, and fee payment confirmation.",
      candidate: null,
    },
  },
  // ── Post-submission outcome stages (orders 17-18) ─────────────────────────
  {
    key: "submission", order: 17, title: "Submission", govSection: "Section 8",
    tasks: {
      sponsor: "Acknowledge that the application has been submitted.",
      caseworker: "Generate the submission sheet and submit to UKVI.",
      admin: "Carry out a final review and authorise submission.",
      candidate: "Be notified that the application has been submitted.",
    },
  },
  {
    key: "decision_activation", order: 18, title: "UKVI Decision & Activation", govSection: "Outcome",
    tasks: {
      sponsor: "Receive the licence and begin assigning Certificates of Sponsorship.",
      caseworker: "Coordinate any UKVI requests for further information.",
      admin: "Record the decision and activate the licence (SLN, issue/expiry dates).",
      candidate: "Receive a CoS and proceed to the visa application.",
    },
  },
];

const STAGE_BY_KEY = Object.fromEntries(LICENCE_STAGE_DEFINITIONS.map((s) => [s.key, s]));

// ─── Phase mapping ────────────────────────────────────────────────────────────

/**
 * Maps each of the 18 stage keys to the 5-phase workflow architecture.
 *
 * Phase 2 (Application)       = stages 1–10  (enquiry through intake)
 * Phase 3 (Review & Approval) = stages 11–18 (government pipeline through UKVI decision)
 *
 * Phases 1 (Onboarding), 4 (CoS), 5 (Workers) operate outside the stage
 * pipeline and are enforced by dedicated middleware and services.
 */
export const STAGE_PHASE_MAP = {
  enquiry_onboarding:            2,
  licence_routes:                2,
  organisation_details:          2,
  cos_requirements:              2,
  supporting_documents:          2,
  key_personnel:                 2,
  declarations:                  2,
  payment:                       2,
  intake_information_form:       2,
  intake_document_checklist:     2,
  sponsor_information_provision: 3,
  government_sms_registration:   3,
  sponsor_portal_onboarding:     3,
  government_portal_credentials: 3,
  government_application_forms:  3,
  government_submission:         3,
  submission:                    3,
  decision_activation:           3,
};

/**
 * Within-stage role execution order. A role may not complete its task until
 * every role listed before it in this array has completed theirs for the
 * same stage.
 *
 * Default (no explicit entry): ["sponsor", "caseworker", "admin"]
 * Government-pipeline stages where the caseworker drives portal work first
 * are listed explicitly with reversed ordering.
 */
const STAGE_ROLE_ORDER = {
  // Data-entry stages (1–10) use the default order: sponsor → caseworker → admin.
  // Government-pipeline stages: caseworker operates the portal first, then
  // sponsor confirms receipt/submission, then admin records the outcome.
  government_sms_registration:   ["caseworker", "sponsor", "admin"],
  sponsor_portal_onboarding:     ["caseworker", "sponsor", "admin"],
  government_portal_credentials: ["caseworker", "sponsor", "admin"],
  government_application_forms:  ["caseworker", "admin"],
  government_submission:         ["caseworker", "sponsor", "admin"],
};

const DEFAULT_ROLE_ORDER = ["sponsor", "caseworker", "admin", "candidate"];

/** Returns the within-stage role execution order for the given stage key. */
export function stageRoleOrder(stageKey) {
  return STAGE_ROLE_ORDER[stageKey] ?? DEFAULT_ROLE_ORDER;
}

/**
 * Minimum application statuses required before certain government-pipeline
 * stages can be acted on.
 *
 * Attempting to complete a task in a gated stage while the application has not
 * yet reached the required status yields HTTP 409 (phase not yet unlocked).
 * Stages without an entry here have no application-status prerequisite.
 */
export const STAGE_STATUS_GATE = {
  sponsor_information_provision: new Set(["Under Review", "Information Requested", "Government Processing", "Decision Pending"]),
  government_sms_registration:   new Set(["Government Processing", "Decision Pending"]),
  sponsor_portal_onboarding:     new Set(["Government Processing", "Decision Pending"]),
  government_portal_credentials: new Set(["Government Processing", "Decision Pending"]),
  government_application_forms:  new Set(["Government Processing", "Decision Pending"]),
  government_submission:         new Set(["Government Processing", "Decision Pending"]),
  submission:                    new Set(["Government Processing", "Decision Pending"]),
  decision_activation:           new Set(["Decision Pending"]),
};

// ─── Stage-level sequential validators ───────────────────────────────────────

/**
 * Asserts that all task rows in every stage BEFORE `stageDef` are completed.
 * Throws HTTP 409 if any incomplete predecessor tasks exist in the DB.
 */
export async function checkSequentialOrder(tenantDb, applicationId, stageDef) {
  if (stageDef.order <= 1) return;
  const { Op } = tenantDb.Sequelize;
  const incompletePrevious = await tenantDb.LicenceStageTask.count({
    where: {
      licenceApplicationId: applicationId,
      stageOrder: { [Op.lt]: stageDef.order },
      status: { [Op.ne]: "completed" },
    },
  });
  if (incompletePrevious > 0) {
    const e = new Error(
      `Complete all tasks in earlier stages before advancing to "${stageDef.title}" (${incompletePrevious} task(s) remaining).`,
    );
    e.statusCode = 409;
    throw e;
  }
}

/**
 * Asserts that all roles with a higher-priority position in the stage's role
 * execution order have completed their task before `role` can complete theirs.
 *
 * Example: for most data-entry stages the order is sponsor → caseworker → admin.
 * A caseworker cannot mark their review done if the sponsor has not yet
 * provided the underlying data.
 *
 * Throws HTTP 409 if any preceding-role tasks are still incomplete.
 */
export async function checkIntraStageOrder(tenantDb, applicationId, stageDef, role) {
  const roleOrder = stageRoleOrder(stageDef.key);
  const roleIndex = roleOrder.indexOf(role);
  if (roleIndex <= 0) return; // first in sequence, or role absent from order — no prerequisite

  // Only check roles that actually have a task defined for this stage.
  const precedingRoles = roleOrder
    .slice(0, roleIndex)
    .filter((r) => stageDef.tasks[r] != null);

  if (precedingRoles.length === 0) return;

  const { Op } = tenantDb.Sequelize;
  const completedCount = await tenantDb.LicenceStageTask.count({
    where: {
      licenceApplicationId: applicationId,
      stageKey: stageDef.key,
      role: { [Op.in]: precedingRoles },
      status: "completed",
    },
  });

  if (completedCount < precedingRoles.length) {
    const e = new Error(
      `Complete the ${precedingRoles.join(" and ")} task(s) in "${stageDef.title}" before the ${role} task can be marked done.`,
    );
    e.statusCode = 409;
    throw e;
  }
}

/**
 * Asserts that the application's current status meets the minimum required for
 * the given stage. Synchronous — no DB access needed.
 * Throws HTTP 409 if the phase gate is not yet open.
 */
export function checkStatusGate(application, stageDef) {
  const gate = STAGE_STATUS_GATE[stageDef.key];
  if (!gate) return;
  if (!gate.has(application.status)) {
    const allowed = [...gate].join(" or ");
    const e = new Error(
      `Stage "${stageDef.title}" is not accessible while the application is "${application.status}". Required status: ${allowed}.`,
    );
    e.statusCode = 409;
    throw e;
  }
}

// ─── Active-stage query ───────────────────────────────────────────────────────

/**
 * Returns the key of the first stage in the pipeline that still has at least
 * one incomplete task row, or null if every seeded stage is fully complete.
 *
 * Only seeded stages (rows in licence_stage_tasks) are considered. A stage
 * that has not been seeded yet is not the active stage — it is locked.
 */
export async function getActiveStageKey(tenantDb, applicationId) {
  if (!tenantDb?.LicenceStageTask) return LICENCE_STAGE_DEFINITIONS[0].key;

  const rows = await tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: applicationId },
    attributes: ["stageKey", "stageOrder", "status"],
    order: [["stageOrder", "ASC"]],
  });

  if (!rows.length) return LICENCE_STAGE_DEFINITIONS[0].key;

  // Aggregate per stage: track the lowest order and whether any task is incomplete.
  const stageInfo = new Map();
  for (const r of rows) {
    if (!stageInfo.has(r.stageKey)) {
      stageInfo.set(r.stageKey, { order: r.stageOrder, incomplete: 0 });
    }
    if (r.status !== "completed") {
      stageInfo.get(r.stageKey).incomplete += 1;
    }
  }

  // Walk stages in ascending order and return the first with any incomplete task.
  const sorted = [...stageInfo.entries()].sort((a, b) => a[1].order - b[1].order);
  for (const [key, info] of sorted) {
    if (info.incomplete > 0) return key;
  }

  return null; // all seeded stages are fully complete
}

// ─── Task chain structure ─────────────────────────────────────────────────────

/**
 * Returns the ordered list of roles that have non-null tasks for a given stage.
 * Order follows stageRoleOrder() — sponsor-first for data-entry stages,
 * caseworker-first for government-pipeline stages.
 *
 * Exported so tests and getStagesForApplication can enumerate the role slots
 * for a stage without re-reading the definition arrays.
 */
export function getChainSequence(stageDef) {
  return stageRoleOrder(stageDef.key).filter((r) => stageDef.tasks[r] != null);
}

/**
 * Flat, ordered list of every (stageDef, role) node in the task chain.
 *
 * The chain is: for each stage in ascending order, for each role returned by
 * getChainSequence(stage), one node. Completing node[i] creates node[i+1].
 * Evaluated once at module load — treated as an immutable constant.
 */
export const TASK_CHAIN = Object.freeze(
  LICENCE_STAGE_DEFINITIONS.flatMap((stageDef) =>
    getChainSequence(stageDef).map((role) => Object.freeze({ stageDef, role })),
  ),
);

/** O(1) lookup: chain index by "stageKey:role" composite key. */
const CHAIN_INDEX = new Map(
  TASK_CHAIN.map((node, i) => [`${node.stageDef.key}:${node.role}`, i]),
);

/**
 * Returns the next chain node after the given (stageKey, role) position,
 * or null when the end of the chain has been reached.
 */
export function nextChainNode(stageKey, role) {
  const idx = CHAIN_INDEX.get(`${stageKey}:${role}`);
  if (idx == null || idx >= TASK_CHAIN.length - 1) return null;
  return TASK_CHAIN[idx + 1];
}

const fullName = (u) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || u?.email || null;

const frontend = () => process.env.FRONTEND_URL || "";

// ─── Data-signal completion inference (mirrors the frontend deriveStageStatuses) ──

function deriveStageCompletion(app) {
  const completed = new Set();
  if (!app) return { completed, currentKey: LICENCE_STAGE_DEFINITIONS[0].key };

  const status = app.status;
  const submitted = !!app.submittedAt && status !== "Draft";
  const docs = app.appendixDocuments || [];
  const docsComplete = docs.length > 0 && docs.every((d) => d.verificationStatus === "Verified");

  // Status-based sentinels for government pipeline stages.
  // These use the application status as the primary completion signal until
  // government tracking data (governmentRegistrationRef etc.) is available in
  // the app shape. Refined signals can be added when the V2 serializer includes
  // the licence_government_tracking columns.
  const govActive = ["Government Processing", "Decision Pending", "Approved"].includes(status);
  const decisionActive = ["Decision Pending", "Approved"].includes(status);
  // Sponsor information provision is done once the application left Pending —
  // either assigned for review or sent back for info.
  const infoProvided = submitted && !["Draft", "Pending"].includes(status);

  const signal = {
    enquiry_onboarding:             true,
    licence_routes:                 (app.routes || []).length > 0,
    organisation_details:           !!(app.organisationInfo && (app.organisationInfo.companiesHouseNumber || app.organisationInfo.organisationType)),
    cos_requirements:               (app.cosRequirements || []).length > 0,
    supporting_documents:           docsComplete,
    key_personnel:                  !!app.authorisingOfficer,
    declarations:                   !!(app.declaration && app.declaration.accuracyConfirmed),
    payment:                        submitted || app.fee?.total != null,
    // Intake stages (orders 9-10) — status-inferred, same pattern as Phase 2.
    // Intake form and document data live in separate tables not included in the
    // V2 serializer shape, so we use application status as the completion proxy:
    //   - information form: considered done once the application is under active
    //     review (caseworker has received and acknowledged it — "Under Review" or beyond).
    //   - document checklist: considered done once government registration has been
    //     triggered, which the engine only allows after all intake docs are verified.
    intake_information_form:        infoProvided,   // Under Review / Info Requested / Gov Processing / Decision Pending / Approved
    intake_document_checklist:      govActive,      // Government Processing / Decision Pending / Approved
    // Phase 2 — government pipeline (status-inferred until tracking data is in shape)
    sponsor_information_provision:  infoProvided,
    government_sms_registration:    govActive,
    sponsor_portal_onboarding:      govActive,
    government_portal_credentials:  govActive,
    government_application_forms:   decisionActive,
    government_submission:          decisionActive,
    // Outcome stages
    submission:                     submitted,
    decision_activation:            status === "Approved",
  };

  if (status === "Approved") {
    LICENCE_STAGE_DEFINITIONS.forEach((s) => completed.add(s.key));
    return { completed, currentKey: null };
  }

  let currentKey = null;
  for (const s of LICENCE_STAGE_DEFINITIONS) {
    if (signal[s.key]) completed.add(s.key);
    else if (!currentKey) currentKey = s.key;
  }
  return { completed, currentKey };
}

/** Build the serialized V2 shape (preferred) or a minimal shape from the plain row. */
async function buildAppShape(tenantDb, application) {
  try {
    const full = await loadFullApplication(tenantDb, application.id, {});
    if (full) return serializeApplication(full);
  } catch (err) {
    logger.error({ err }, "licenceStageTask: loadFullApplication failed; using plain shape");
  }
  // Fallback for V1 / non-normalized rows — infer from the parent columns.
  return {
    status: application.status,
    submittedAt: application.submittedAt || (application.status && application.status !== "Draft" ? application.createdAt : null),
    routes: application.licenceType ? [application.licenceType] : [],
    organisationInfo: application.registrationNumber ? { companiesHouseNumber: application.registrationNumber } : null,
    cosRequirements: application.cosAllocation ? [{ candidateName: application.contactName }] : [],
    appendixDocuments: [],
    authorisingOfficer: application.contactName ? { firstName: application.contactName } : null,
    declaration: null,
    fee: { total: application.feeTotal ?? null },
  };
}

// ─── Role → person resolution ─────────────────────────────────────────────────

export async function resolveRoleRecipients(tenantDb, application) {
  const out = { sponsor: null, caseworkers: [], admin: null, candidate: null };

  // Sponsor = the application owner.
  if (application.userId) {
    const u = await tenantDb.User.findByPk(application.userId, {
      attributes: ["id", "first_name", "last_name", "email"],
    }).catch(() => null);
    if (u) out.sponsor = { userId: u.id, name: fullName(u), email: u.email };
  }

  // Caseworker(s) = the assigned reviewer(s).
  const cwIds = extractCaseworkerIds(application.assignedcaseworkerId);
  if (cwIds.length) {
    const cws = await tenantDb.User.findAll({
      where: { id: cwIds },
      attributes: ["id", "first_name", "last_name", "email"],
    }).catch(() => []);
    out.caseworkers = cws.map((u) => ({ userId: u.id, name: fullName(u), email: u.email }));
  }

  // Admin = a tenant admin (prefer active, fall back to any).
  const adminWhereActive = { role_id: ROLES.ADMIN, status: "active" };
  let admin = await tenantDb.User.findOne({
    where: adminWhereActive,
    order: [["id", "ASC"]],
    attributes: ["id", "first_name", "last_name", "email"],
  }).catch(() => null);
  if (!admin) {
    admin = await tenantDb.User.findOne({
      where: { role_id: ROLES.ADMIN },
      order: [["id", "ASC"]],
      attributes: ["id", "first_name", "last_name", "email"],
    }).catch(() => null);
  }
  if (admin) out.admin = { userId: admin.id, name: fullName(admin), email: admin.email };

  // Candidate = the CoS contact (free-text on the licence; not a user record).
  try {
    const cos = await tenantDb.LicenceCosRequirement.findOne({
      where: { licenceApplicationId: application.id },
      attributes: ["candidateName", "candidateEmail"],
      order: [["id", "ASC"]],
    });
    if (cos && (cos.candidateName || cos.candidateEmail)) {
      out.candidate = { userId: null, name: cos.candidateName || null, email: cos.candidateEmail || null };
    }
  } catch {
    /* CoS model may be absent on legacy rows — candidate stays null */
  }

  return out;
}

function pickAssignee(role, recipients) {
  switch (role) {
    case "sponsor": return recipients.sponsor;
    case "admin": return recipients.admin;
    // Return a display-only placeholder when no caseworker is assigned yet.
    // userId stays null so no fake ID is written; the real values are filled
    // in by the first patch branch in seedStageRows once a caseworker is assigned.
    case "caseworker": return recipients.caseworkers[0] || { userId: null, name: "Awaiting Assignment", email: null };
    case "candidate": return recipients.candidate;
    default: return null;
  }
}

// ─── Single-task seeding ──────────────────────────────────────────────────────

/**
 * Seeds exactly ONE task row for the given (stage, role) pair.
 *
 * Idempotent via findOrCreate. On first creation:
 *   - Auto-completes sponsor/candidate tasks when the data signal says the
 *     work is already done (bootstrap for pre-existing applications).
 *   - Appends an AUDIT log entry recording the task creation.
 *   - Fires an in-app + email notification to the assignee (skip if
 *     auto-completed — no action is needed from them).
 *
 * On subsequent calls for the same (stage, role) it only updates the
 * assignee when a caseworker is assigned or changed.
 *
 * Returns { row, isNew, wasAutoCompleted } or null if the role has no task.
 */
async function seedSingleTask(tenantDb, application, stage, role, ctx) {
  const { org, completed, recipients, req } = ctx;
  const taskText = stage.tasks[role];
  if (!taskText) return null;

  const assignee = pickAssignee(role, recipients);
  const autoComplete = roleAutoCompletes(role, completed.has(stage.key), application.status);

  const [row, isNew] = await tenantDb.LicenceStageTask.findOrCreate({
    where: { licenceApplicationId: application.id, stageKey: stage.key, role },
    defaults: {
      organisationId: org,
      stageOrder: stage.order,
      role,
      title: taskText,
      description: stage.title,
      assignedToUserId: assignee?.userId ?? null,
      assigneeName: assignee?.name ?? null,
      assigneeEmail: assignee?.email ?? null,
      status: autoComplete ? "completed" : "pending",
      completedAt: autoComplete ? new Date() : null,
      metadata: { govSection: stage.govSection },
    },
  });

  if (!isNew) {
    // Sync assignee when a caseworker is added or changed after initial seeding.
    const patch = {};
    if (assignee?.userId != null && row.assignedToUserId !== assignee.userId) {
      patch.assignedToUserId = assignee.userId;
      patch.assigneeName    = assignee.name  ?? null;
      patch.assigneeEmail   = assignee.email ?? null;
    } else if (assignee && row.assignedToUserId == null && (assignee.name || assignee.email)) {
      const newName  = assignee.name  ?? null;
      const newEmail = assignee.email ?? null;
      if (newName  !== row.assigneeName)  patch.assigneeName  = newName;
      if (newEmail !== row.assigneeEmail) patch.assigneeEmail = newEmail;
    }
    if (Object.keys(patch).length) await row.update(patch);
    return { row, isNew: false, wasAutoCompleted: false };
  }

  // ── Audit: record that this task was created by the chain engine ─────────────
  const orgId = org != null && !Number.isNaN(Number(org)) ? Number(org) : null;
  tenantDb.AuditLog.create({
    user_id:         null,
    organisation_id: orgId,
    action:          "LICENCE_STAGE_TASK_CREATED",
    resource:        "licence_stage_task",
    ip_address:      null,
    status:          "Success",
    details: JSON.stringify({
      applicationId: application.id,
      stageKey:      stage.key,
      stageOrder:    stage.order,
      role,
      taskId:        row.id,
      autoCompleted: autoComplete,
      chainAdvance:  true,
    }),
  }).catch((err) =>
    logger.warn({ err, applicationId: application.id, stageKey: stage.key, role }, "seedSingleTask: audit failed"),
  );

  // ── Notify the assignee (skip if auto-completed — no action needed) ───────────
  if (!autoComplete && assignee?.userId) {
    deliver({
      tenantDb,
      recipientUserId: assignee.userId,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      category: "sponsorship",
      title: `New task assigned: ${stage.title}`,
      message: taskText,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_stage_task_assigned",
      actionUrl: actionUrlForAudience(role),
      req,
      organisationId: org,
    }).catch((err) =>
      logger.warn({ err, applicationId: application.id, stageKey: stage.key, role }, "seedSingleTask: notify failed"),
    );
  }

  return { row, isNew: true, wasAutoCompleted: autoComplete };
}

/**
 * Seeds the next task in the chain after `completedRole` has finished in `stageDef`.
 *
 * Resolution order:
 *   1. If there is another role in the same stage after `completedRole` → seed it.
 *   2. If `completedRole` was the last role in its stage → seed the first role
 *      of the next stage, automatically advancing to the next phase when needed.
 *
 * If the newly created task is auto-completable (the underlying data signal is
 * already satisfied), it is marked complete immediately and the chain continues
 * recursively until a task requiring human action is reached.
 *
 * Depth-limited to guard against data-signal misconfiguration infinite loops.
 */
async function seedNextInChain(tenantDb, application, stageDef, completedRole, ctx, depth = 0) {
  if (depth > TASK_CHAIN.length) {
    logger.error(
      { applicationId: application.id, stageKey: stageDef.key, completedRole },
      "seedNextInChain: depth limit exceeded — check roleAutoCompletes signals",
    );
    return;
  }

  const next = nextChainNode(stageDef.key, completedRole);
  if (!next) return; // end of chain reached

  const result = await seedSingleTask(tenantDb, application, next.stageDef, next.role, ctx).catch(
    (err) => {
      logger.error(
        { err, applicationId: application.id, stageKey: next.stageDef.key, role: next.role },
        "seedNextInChain: seedSingleTask failed",
      );
      return null;
    },
  );

  // If the just-created task was immediately auto-completed, keep the chain moving.
  if (result?.isNew && result.wasAutoCompleted) {
    await seedNextInChain(tenantDb, application, next.stageDef, next.role, ctx, depth + 1);
  }
}

/**
 * Ensures the correct task exists at the chain frontier for this application.
 *
 * Chain-frontier model:
 *   Only the NEXT task in the sequence is seeded. Tasks further ahead are not
 *   pre-created; they appear as "locked" placeholders in the panel view-model
 *   until the preceding task is completed and the chain advances.
 *
 * Frontier resolution:
 *   Walk TASK_CHAIN in order. The first node whose DB row is absent or not yet
 *   completed is the frontier. If the row is absent, seed it (and keep going if
 *   it was auto-completed). If the row already exists and is pending, do nothing.
 *
 * Terminal statuses (Approved / Rejected):
 *   Seed every chain node so the full history is visible in the panel.
 *
 * Safe to call repeatedly — findOrCreate is idempotent, completed rows are
 * never un-completed, and assignees are only updated when they change.
 *
 * @returns {Promise<Array>} all task rows currently in DB for the application.
 */
export async function ensureStageTasks(tenantDb, applicationOrId, { req = null, organisationId = null } = {}) {
  if (!tenantDb?.LicenceStageTask) return [];
  const application =
    typeof applicationOrId === "object" && applicationOrId !== null
      ? applicationOrId
      : await tenantDb.LicenceApplication.findByPk(applicationOrId);
  if (!application) return [];

  const org = organisationId ?? application.organisationId ?? req?.user?.organisation_id ?? null;
  const appShape = await buildAppShape(tenantDb, application);
  const { completed } = deriveStageCompletion(appShape);
  const recipients = await resolveRoleRecipients(tenantDb, application);
  const ctx = { org, completed, recipients, req };

  // Terminal: seed every chain node so the history panel is fully populated.
  if (["Approved", "Rejected"].includes(application.status)) {
    for (const { stageDef, role } of TASK_CHAIN) {
      await seedSingleTask(tenantDb, application, stageDef, role, ctx).catch((err) =>
        logger.warn({ err, stageKey: stageDef.key, role }, "ensureStageTasks: terminal seed failed"),
      );
    }
    return tenantDb.LicenceStageTask.findAll({
      where: { licenceApplicationId: application.id },
      order: [["stageOrder", "ASC"]],
    });
  }

  // Non-terminal: find and seed the frontier — the first chain node that
  // doesn't yet have a completed row in the DB.
  const existingRows = await tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: application.id },
    attributes: ["stageKey", "role", "status"],
    order: [["stageOrder", "ASC"]],
  });

  const rowStatus = new Map(
    existingRows.map((r) => [`${r.stageKey}:${r.role}`, r.status]),
  );

  for (const { stageDef, role } of TASK_CHAIN) {
    const status = rowStatus.get(`${stageDef.key}:${role}`);
    if (status === "completed") continue; // chain has passed this node

    if (!status) {
      // Row doesn't exist yet — seed the frontier task.
      const result = await seedSingleTask(tenantDb, application, stageDef, role, ctx).catch(
        (err) => {
          logger.error({ err, stageKey: stageDef.key, role }, "ensureStageTasks: seed failed");
          return null;
        },
      );
      // If auto-completed, advance the frontier immediately.
      if (result?.isNew && result.wasAutoCompleted) {
        await seedNextInChain(tenantDb, application, stageDef, role, ctx);
      }
    }
    // Row is pending or was just seeded — frontier handled. Stop.
    break;
  }

  return tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: application.id },
    order: [["stageOrder", "ASC"]],
  });
}

/**
 * Whether a role's task should be auto-completed from the application's data.
 *
 * The stage-level data signal (deriveStageCompletion) reflects that the SPONSOR
 * has provided the data for that stage — it does NOT mean the reviewer
 * (caseworker/admin) has done their review/QA/approval. So pre-decision we only
 * auto-complete the data-provider roles (sponsor + candidate); caseworker and
 * admin tasks remain actionable until explicitly completed. Once the licence is
 * Approved, every task is genuinely done.
 */
function roleAutoCompletes(role, dataComplete, appStatus) {
  if (appStatus === "Approved") return true;
  if (dataComplete) return true; // Auto-complete all roles if stage data is fully complete
  return role === "sponsor" || role === "candidate";
}

// ─── Read model for the panel ───────────────────────────────────────────────────

/**
 * Returns the panel view-model: every stage with its per-role tasks, assignees
 * and completion, plus the stage-level status and the currently-actionable
 * stage. Seeds rows on first read.
 *
 * Stage status is DATA-DRIVEN (deriveStageCompletion) so the timeline always
 * reflects where the application actually is, independent of whether each role
 * has ticked their individual task. Per-role task status is carried from the
 * task rows so the panel can still show who has/hasn't acted.
 */
export async function getStagesForApplication(tenantDb, applicationOrId, { req = null } = {}) {
  const application =
    typeof applicationOrId === "object" && applicationOrId !== null
      ? applicationOrId
      : await tenantDb.LicenceApplication.findByPk(applicationOrId);
  if (!application) return null;

  await ensureStageTasks(tenantDb, application, { req });

  const appShape = await buildAppShape(tenantDb, application);
  const { completed, currentKey } = deriveStageCompletion(appShape);
  const rejected = application.status === "Rejected";

  const rows = await tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: application.id },
    order: [["stageOrder", "ASC"], ["id", "ASC"]],
  });

  const byStage = new Map();
  for (const r of rows) {
    if (!byStage.has(r.stageKey)) byStage.set(r.stageKey, []);
    byStage.get(r.stageKey).push(r);
  }

  const stages = LICENCE_STAGE_DEFINITIONS.map((def) => {
    // Index DB rows for this stage by role for O(1) look-up.
    const dbByRole = new Map(
      (byStage.get(def.key) || []).map((t) => [t.role, t]),
    );

    // Emit a task entry for every role in the stage's chain sequence.
    // Roles that haven't been seeded yet appear as "locked" placeholders so
    // the panel always shows the complete upcoming task list without creating
    // rows in advance.
    const tasks = getChainSequence(def).map((role) => {
      const t = dbByRole.get(role);
      if (t) {
        return {
          id: t.id,
          role: t.role,
          title: t.title,
          status: t.status,
          assigneeName: t.assigneeName,
          assigneeEmail: t.assigneeEmail,
          assignedToUserId: t.assignedToUserId,
          completedAt: t.completedAt,
          dueDate: t.dueDate,
        };
      }
      // No DB row yet — task is in the future, not yet created by the chain.
      return {
        id: null,
        role,
        title: def.tasks[role],
        status: "locked",
        assigneeName: null,
        assigneeEmail: null,
        assignedToUserId: null,
        completedAt: null,
        dueDate: null,
      };
    });

    let stageStatus = completed.has(def.key) ? "completed" : def.key === currentKey ? "in_progress" : "pending";
    if (rejected && def.key === "decision_activation") stageStatus = "rejected";
    return { key: def.key, order: def.order, title: def.title, govSection: def.govSection, status: stageStatus, tasks };
  });

  return { applicationId: application.id, status: application.status, currentStageKey: currentKey, stages };
}

// ─── Authorisation ──────────────────────────────────────────────────────────────

/** Map a user's role_id to the stage role they may act as. */
function actorRoleKey(actorUser) {
  const rid = Number(actorUser?.role_id ?? actorUser?.roleId);
  if (rid === ROLES.ADMIN || rid === ROLES.SUPERADMIN) return "admin";
  if (rid === ROLES.CASEWORKER) return "caseworker";
  if (rid === ROLES.BUSINESS) return "sponsor";
  if (rid === ROLES.CANDIDATE) return "candidate";
  return null;
}

function canCompleteRole(actorUser, role) {
  const key = actorRoleKey(actorUser);
  if (key === "admin") return true; // admins may complete any role's task
  return key === role;
}

// ─── Completion + notifications ──────────────────────────────────────────────────

/**
 * Complete one stage task on behalf of a role, then notify the parties who need
 * to know (in-app + email) and record an audit entry. Idempotent.
 */
export async function completeStageTask(tenantDb, { applicationId, stageKey, role, actorUser, req = null }) {
  const stageDef = STAGE_BY_KEY[stageKey];
  if (!stageDef) {
    const e = new Error("Unknown stage"); e.statusCode = 400; throw e;
  }
  if (!STAGE_ROLE_KEYS.includes(role)) {
    const e = new Error("Unknown role"); e.statusCode = 400; throw e;
  }
  if (!canCompleteRole(actorUser, role)) {
    const e = new Error("You are not permitted to complete this task"); e.statusCode = 403; throw e;
  }

  const application = await tenantDb.LicenceApplication.findByPk(applicationId);
  if (!application) {
    const e = new Error("Licence application not found"); e.statusCode = 404; throw e;
  }

  // Phase gate: certain government-pipeline stages require the application to
  // have reached a specific status before any role can act on them.
  checkStatusGate(application, stageDef);

  await ensureStageTasks(tenantDb, application, { req });

  const task = await tenantDb.LicenceStageTask.findOne({
    where: { licenceApplicationId: applicationId, stageKey, role },
  });

  if (!task) {
    // Distinguish "future stage not yet unlocked" from "invalid stage/role combo".
    const activeKey = await getActiveStageKey(tenantDb, applicationId);
    const activeOrder = activeKey ? (STAGE_BY_KEY[activeKey]?.order ?? 0) : Infinity;
    if (stageDef.order > activeOrder) {
      const e = new Error(
        `Stage "${stageDef.title}" is not yet unlocked. Complete "${STAGE_BY_KEY[activeKey]?.title}" first.`,
      );
      e.statusCode = 409;
      throw e;
    }
    const e = new Error("Task not found for this stage and role"); e.statusCode = 404; throw e;
  }

  if (task.status === "completed") return task; // idempotent

  // Sequential enforcement: all tasks in every earlier stage must be completed
  // before any task in this stage can be marked done.
  await checkSequentialOrder(tenantDb, applicationId, stageDef);

  // Within-stage role ordering: earlier roles in the execution sequence must
  // complete their task before later roles can complete theirs.
  await checkIntraStageOrder(tenantDb, applicationId, stageDef, role);

  const actorId = actorUser?.userId ?? null;
  const org = application.organisationId ?? req?.user?.organisation_id ?? null;

  let ipAddress = null;
  if (req) {
    ipAddress = req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || null;
    if (ipAddress?.includes(",")) ipAddress = ipAddress.split(",")[0].trim();
  }

  // Task completion and its audit entry are atomic: if the audit write fails,
  // the task stays incomplete and can be retried. Notifications are best-effort
  // and happen after the transaction commits so a notification failure cannot
  // roll back the completion.
  await tenantDb.sequelize.transaction(async (t) => {
    await task.update(
      {
        status: "completed",
        completedAt: new Date(),
        completedByUserId: actorId,
      },
      { transaction: t },
    );

    await tenantDb.AuditLog.create(
      {
        user_id:         actorId,
        organisation_id: org != null && !Number.isNaN(Number(org)) ? Number(org) : null,
        action:          "LICENCE_STAGE_TASK_COMPLETED",
        resource:        "licence_stage_task",
        ip_address:      ipAddress,
        status:          "Success",
        details: JSON.stringify({
          applicationId: application.id,
          stageKey:      stageDef.key,
          role,
          taskId:        task.id,
        }),
      },
      { transaction: t },
    );
  });

  // ── Chain advancement: create the next task now that this one is done ────────
  // Runs after the transaction so the completion row is visible to findOrCreate.
  // Uses fresh data signals and recipients in case caseworkers were assigned or
  // form data was saved during this request.
  {
    const appShape = await buildAppShape(tenantDb, application);
    const { completed: freshCompleted } = deriveStageCompletion(appShape);
    const freshRecipients = await resolveRoleRecipients(tenantDb, application);
    const chainCtx = {
      org: application.organisationId ?? req?.user?.organisation_id ?? null,
      completed: freshCompleted,
      recipients: freshRecipients,
      req,
    };
    await seedNextInChain(tenantDb, application, stageDef, role, chainCtx).catch((err) =>
      logger.error({ err, applicationId, stageKey, role }, "completeStageTask: chain advance failed"),
    );
  }

  // ── Fan-out notifications (in-app + email) — best-effort, never throws ────────
  try {
    await notifyStageTaskCompleted({ tenantDb, application, stageDef, role, task, actorUser, req });
  } catch (err) {
    logger.error({ err }, "completeStageTask: notification failed");
  }

  return task;
}

/**
 * Fan a "task completed" event across in-app + email to the parties who care
 * (tenant admin, sponsor owner, assigned caseworkers, and the candidate by
 * email), skipping the actor. The audit row is written atomically by
 * completeStageTask() before this function is called; it is not re-written here.
 */
async function notifyStageTaskCompleted({ tenantDb, application, stageDef, role, task, actorUser, req }) {
  const recipients = await resolveRoleRecipients(tenantDb, application);
  const org = application.organisationId ?? req?.user?.organisation_id ?? null;
  const actorId = actorUser?.userId ?? null;
  const company = application.companyName || `#LIC-${application.id}`;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  const targets = [];
  if (recipients.admin?.userId) targets.push({ ...recipients.admin, audience: "admin" });
  if (recipients.sponsor?.userId) targets.push({ ...recipients.sponsor, audience: "sponsor" });
  // Tell assigned caseworkers too (they coordinate the review).
  for (const cw of recipients.caseworkers) {
    if (cw.userId) targets.push({ ...cw, audience: "caseworker" });
  }
  // The candidate is a free-text CoS contact (no portal user) — notify by email only.
  if (recipients.candidate?.email) targets.push({ ...recipients.candidate, audience: "candidate" });

  const seenUsers = new Set();
  const seenEmails = new Set();
  for (const t of targets) {
    // Never notify the actor; dedupe users by id and email-only recipients by email.
    if (t.userId) {
      if (t.userId === actorId || seenUsers.has(t.userId)) continue;
      seenUsers.add(t.userId);
    } else {
      if (!t.email || seenEmails.has(t.email)) continue;
      seenEmails.add(t.email);
    }
    await deliver({
      tenantDb,
      recipientUserId: t.userId || null,
      recipientEmail: t.email,
      recipientName: t.name || "there",
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.MEDIUM,
      category: "sponsorship",
      title: `Licence stage progressed: ${stageDef.title}`,
      message: `${roleLabel} completed "${task.title}" for ${company} (stage: ${stageDef.title}).`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_stage_task_completed",
      actionUrl: actionUrlForAudience(t.audience),
      audit: null, // recorded once above
      req,
      organisationId: org,
    });
  }
}

function actionUrlForAudience(audience) {
  switch (audience) {
    case "admin": return "/admin/licence-requests";
    case "caseworker": return "/caseworker/licence-reviews";
    case "sponsor": return "/business/licence-process";
    default: return null;
  }
}

export default {
  LICENCE_STAGE_DEFINITIONS,
  STAGE_ROLE_KEYS,
  STAGE_PHASE_MAP,
  STAGE_STATUS_GATE,
  TASK_CHAIN,
  stageRoleOrder,
  getChainSequence,
  nextChainNode,
  checkSequentialOrder,
  checkIntraStageOrder,
  checkStatusGate,
  getActiveStageKey,
  resolveRoleRecipients,
  ensureStageTasks,
  getStagesForApplication,
  completeStageTask,
};
