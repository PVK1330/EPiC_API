import logger from "../utils/logger.js";
import { ROLES } from "../middlewares/role.middleware.js";
import { deliver } from "./sponsorshipNotification.service.js";
import { NotificationTypes, NotificationPriority } from "./notification.service.js";
import { extractCaseworkerIds } from "./licenceAssignment.service.js";
import { loadFullApplication, serializeApplication } from "./licenceApplicationV2.service.js";
import { emitToUser, EVENT_TYPES } from "../realtime/messagingRealtime.js";

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

export const STAGE_ROLE_KEYS = ["sponsor", "caseworker", "admin"];

export const LICENCE_STAGE_DEFINITIONS = [
  {
    key: "enquiry_onboarding", order: 1, title: "Enquiry & Onboarding", govSection: "Intake",
    tasks: {
      sponsor: "Submit a sponsor licence enquiry with basic business details.",
      caseworker: "Acknowledge the assignment and schedule an introductory call.",
      admin: "Triage the enquiry, open the application, and assign a caseworker.",
    },
  },
  {
    key: "licence_routes", order: 2, title: "Licence Routes", govSection: "Section 1",
    tasks: {
      sponsor: "Select the route(s) and declare any existing sponsor licence number (SLN).",
      caseworker: "Advise on the correct route and confirm eligibility.",
      admin: "Verify the selected routes are recorded against the application.",
    },
  },
  {
    key: "organisation_details", order: 3, title: "Organisation Details", govSection: "Section 2",
    tasks: {
      sponsor: "Provide organisation details, trading names, Companies House number and HMRC/PAYE references.",
      caseworker: "Verify the details against Companies House and HMRC records.",
      admin: "QA the captured organisation profile for completeness.",
    },
  },
  {
    key: "cos_requirements", order: 4, title: "CoS & CAS Requirements", govSection: "Section 3",
    tasks: {
      sponsor: "State the number of CoS required and provide detailed justification.",
      caseworker: "Validate the SOC code, salary threshold and genuine vacancy.",
      admin: "Approve the requested CoS allocation.",
    },
  },
  {
    key: "supporting_documents", order: 5, title: "Supporting Documents", govSection: "Section 4",
    tasks: {
      sponsor: "Upload the required Appendix A documents.",
      caseworker: "Review each document and request any missing evidence.",
      admin: "Sign off the document pack as complete.",
    },
  },
  {
    key: "key_personnel", order: 6, title: "Key Personnel & Convictions", govSection: "Section 5",
    tasks: {
      sponsor: "Nominate the Authorising Officer, Key Contact and Level 1 User; declare any convictions.",
      caseworker: "Verify personnel are UK-based, hold an NI number and have a clean record.",
      admin: "Approve the key personnel appointments.",
    },
  },
  {
    key: "declarations", order: 7, title: "Declarations & Representative", govSection: "Section 6",
    tasks: {
      sponsor: "Confirm the application is true and authorise the representative.",
      caseworker: "Complete the representative / OISC declaration.",
      admin: "Counter-sign and approve the declarations.",
    },
  },
  // ── Intake: dedicated information & document collection (orders 8-9) ───────
  {
    key: "intake_information_form", order: 8, title: "Sponsor Information Form", govSection: "Intake",
    tasks: {
      sponsor: "Complete the 12-field Sponsor Information Form: trading name, premises address, named person on licence, NI number, employee counts, CoS required, and more.",
      caseworker: "Review the completed information form for accuracy and completeness before progressing to document verification.",
      admin: "Confirm the information form has been reviewed and approved by the caseworker.",
    },
  },
  {
    key: "intake_document_checklist", order: 9, title: "Document Collection & Verification", govSection: "Intake",
    tasks: {
      sponsor: "Upload all mandatory documents (Employer's Liability Insurance, Certificate of Incorporation, PAYE registration, bank statements, premises evidence, and identity documents). Toggle additional document requirements if applicable (food/alcohol/care business, TUPE, candidate).",
      caseworker: "Verify each uploaded document meets the Home Office requirements. Reject or request further information where needed. All mandatory documents must reach 'Verified' status before Government Registration can proceed.",
      admin: "Confirm all mandatory documents have been verified and the intake stage is complete.",
    },
  },
  // ── Phase 2: Government processing pipeline stages (orders 10-19) ─────────
  {
    key: "sponsor_information_provision", order: 10, title: "Sponsor Information Provision", govSection: "Government Prep",
    tasks: {
      sponsor: "Confirm all organisational details, personnel, and documents are accurate and up-to-date before portal submission.",
      caseworker: "Validate completeness of the sponsor's information pack and confirm readiness for government portal entry.",
      admin: "Authorise the information pack for government portal submission.",
    },
  },
  {
    key: "government_sms_registration", order: 11, title: "Government SMS Registration", govSection: "Government Prep",
    tasks: {
      sponsor: "Await confirmation that your organisation has been registered on the UKVI Sponsorship Management System (SMS).",
      caseworker: "Register the sponsor organisation on the SMS portal and obtain the SMS portal username and registration reference.",
      admin: "Verify the SMS registration details and record the reference number.",
    },
  },
  {
    key: "sponsor_portal_onboarding", order: 12, title: "Sponsor Portal Onboarding", govSection: "Government Prep",
    tasks: {
      sponsor: "Log in to the UKVI Sponsor Management System using the credentials provided and confirm access.",
      caseworker: "Guide the sponsor through the SMS portal login and confirm the sponsor can access their account.",
      admin: "Record that the sponsor has been successfully onboarded to the SMS portal.",
    },
  },
  {
    // UKVI sends credentials to sponsor's email. Sponsor submits them here → caseworker/admin review.
    key: "government_portal_credentials", order: 13, title: "Government Portal Credentials", govSection: "Government Application",
    tasks: {
      sponsor: "UKVI will send your portal credentials directly to your registered email. Once received, log in to this portal and submit your username and password to share them securely with your case team.",
      caseworker: "Review the UKVI portal credentials submitted by the sponsor. Confirm they are correct and record them for completing the UKVI application forms.",
      admin: "Confirm that the UKVI portal credentials have been received from the sponsor and are securely recorded in the system.",
    },
  },
  {
    key: "government_application_forms", order: 14, title: "Government Application Forms", govSection: "Government Application",
    tasks: {
      sponsor: "Log in to the UKVI portal and complete the online sponsor licence application forms.",
      caseworker: "Review and verify all form entries with the sponsor; ensure declarations and supporting data are correctly entered.",
      admin: "Carry out a final QA check of the completed government application forms before submission.",
    },
  },
  {
    key: "government_submission", order: 15, title: "Government Submission", govSection: "Government Application",
    tasks: {
      sponsor: "Confirm submission of the online application to UKVI and note the government submission reference number.",
      caseworker: "Submit the completed online application form to UKVI, record the submission reference and date. A 5 working-day deadline begins now for dispatching physical supporting documents to the Home Office.",
      admin: "Record the government submission reference and date.",
    },
  },
  {
    // Caseworker must dispatch physical supporting documents to the Home Office within 5 working days of UKVI submission.
    key: "home_office_document_dispatch", order: 16, title: "Home Office Document Dispatch", govSection: "Post-Submission",
    tasks: {
      caseworker: "Dispatch the supporting documents package to the Home Office within 5 working days of UKVI submission. Record the dispatch date and any tracking/postal reference.",
      admin: "Confirm that the Home Office document package has been dispatched on time and record the dispatch reference.",
      sponsor: "Your case team will dispatch the required supporting documents to the Home Office on your behalf. You will be notified once this is complete.",
    },
  },
  {
    // Sponsor pays UKVI licence fee directly on the UKVI portal (not to the organisation).
    key: "payment_confirmation", order: 17, title: "UKVI Licence Fee Payment", govSection: "Post-Submission",
    tasks: {
      sponsor: "Pay the sponsor licence fee directly on the UKVI portal. Once payment is confirmed, mark this task as complete below.",
      caseworker: "Confirm that the sponsor has paid the licence fee on the UKVI portal. Check the UKVI portal or obtain written confirmation from the sponsor.",
      admin: "Record the UKVI payment confirmation and update the application accordingly.",
    },
  },
  {
    key: "submission", order: 18, title: "Submission", govSection: "Section 8",
    tasks: {
      sponsor: "Acknowledge that the application has been fully submitted.",
      caseworker: "Generate the submission sheet and confirm all post-submission steps are complete.",
      admin: "Carry out a final review and authorise the completed submission.",
    },
  },
  {
    key: "decision_activation", order: 19, title: "UKVI Decision & Activation", govSection: "Outcome",
    tasks: {
      sponsor: "UKVI will communicate their decision directly to you. If approved, your licence will be activated and you can begin assigning Certificates of Sponsorship. If rejected, a 6-month waiting period applies before you can reapply on UKVI.",
      caseworker: "Coordinate any UKVI requests for further information during the decision period.",
      admin: "Record the UKVI decision and activate the licence (SLN, issue/expiry dates), or record the rejection and set the 6-month reapplication cooldown.",
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
  enquiry_onboarding:              2,
  licence_routes:                  2,
  organisation_details:            2,
  cos_requirements:                2,
  supporting_documents:            2,
  key_personnel:                   2,
  declarations:                    2,
  intake_information_form:         2,
  intake_document_checklist:       2,
  sponsor_information_provision:   3,
  government_sms_registration:     3,
  sponsor_portal_onboarding:       3,
  government_portal_credentials:   3,
  government_application_forms:    3,
  government_submission:           3,
  home_office_document_dispatch:   3,
  payment_confirmation:            3,
  submission:                      3,
  decision_activation:             3,
};

/**
 * SLA (service-level agreement) days per stage.
 * Clock starts when the task row is seeded (i.e. when the assignee's turn begins).
 * dueDate = seedTime + SLA_DAYS stored on the task row.
 */
export const STAGE_SLA_DAYS = {
  enquiry_onboarding:              3,
  licence_routes:                  5,
  organisation_details:            5,
  cos_requirements:                5,
  supporting_documents:            7,
  key_personnel:                   5,
  declarations:                    3,
  intake_information_form:         5,
  intake_document_checklist:       7,
  sponsor_information_provision:   5,
  government_sms_registration:     7,
  sponsor_portal_onboarding:       3,
  government_portal_credentials:   5,
  government_application_forms:    7,
  government_submission:           3,
  home_office_document_dispatch:   5, // 5 working-day Home Office dispatch deadline
  payment_confirmation:            7, // sponsor has 7 days to confirm UKVI payment
  submission:                      5,
  decision_activation:             60,
};

/**
 * Derives SLA traffic-light status from a due date.
 * Returns "red" (overdue), "amber" (due within 2 days), "green" (on track),
 * or null when no due date is set or the task is complete.
 */
export function computeSlaStatus(dueDate) {
  if (!dueDate) return null;
  const daysLeft = (new Date(dueDate).getTime() - Date.now()) / 86_400_000;
  if (daysLeft < 0) return "red";
  if (daysLeft <= 2) return "amber";
  return "green";
}

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
  // Data-entry stages use the default order: sponsor → caseworker → admin.
  // Government-pipeline stages where caseworker drives portal work first.
  government_sms_registration:      ["caseworker", "sponsor", "admin"],
  sponsor_portal_onboarding:        ["caseworker", "sponsor", "admin"],
  // CHANGED (flow v2): UKVI sends credentials to sponsor's email.
  // Sponsor submits them here first; caseworker then reviews; admin confirms.
  government_portal_credentials:    ["sponsor", "caseworker", "admin"],
  government_application_forms:     ["caseworker", "sponsor", "admin"],
  government_submission:            ["caseworker", "sponsor", "admin"],
  // Home Office document dispatch: caseworker dispatches first, admin confirms, sponsor acknowledges.
  home_office_document_dispatch:    ["caseworker", "admin", "sponsor"],
};

const DEFAULT_ROLE_ORDER = ["sponsor", "caseworker", "admin"];

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
  sponsor_information_provision:  new Set(["Under Review", "Information Requested", "Government Processing", "Decision Pending"]),
  government_sms_registration:    new Set(["Government Processing", "Decision Pending"]),
  sponsor_portal_onboarding:      new Set(["Government Processing", "Decision Pending"]),
  government_portal_credentials:  new Set(["Government Processing", "Decision Pending"]),
  government_application_forms:   new Set(["Government Processing", "Decision Pending"]),
  government_submission:          new Set(["Government Processing", "Decision Pending"]),
  home_office_document_dispatch:  new Set(["Government Processing", "Decision Pending"]),
  payment_confirmation:           new Set(["Decision Pending", "Government Processing"]),
  submission:                     new Set(["Government Processing", "Decision Pending"]),
  decision_activation:            new Set(["Government Processing", "Decision Pending"]),
};

// ─── Stage-level sequential validators ───────────────────────────────────────

/**
 * Asserts that all task rows in every stage BEFORE `stageDef` are completed.
 * Throws HTTP 409 if any incomplete predecessor tasks exist in the DB.
 */
export async function checkSequentialOrder(tenantDb, applicationId, stageDef, role = null) {
  if (stageDef.order <= 1) return;
  const { Op } = tenantDb.Sequelize;

  // When a role is provided, only check that role's own earlier tasks are complete.
  // This allows each role to advance through their chain independently:
  //   - Sponsors fill in all wizard steps without waiting for caseworker/admin review.
  //   - Caseworkers review stages in order once sponsor data is in.
  //   - Admins approve in order once caseworker reviews are done.
  // Within-stage ordering (sponsor must precede caseworker, etc.) is enforced
  // separately by checkIntraStageOrder.
  const where = {
    licenceApplicationId: applicationId,
    stageOrder: { [Op.lt]: stageDef.order },
    status: { [Op.ne]: "completed" },
  };
  if (role) where.role = role;

  const incompletePrevious = await tenantDb.LicenceStageTask.count({ where });
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
  // "Licence Granted" is the canonical terminal status set by grantLicence(); treat
  // it identically to "Approved" so the stage engine marks all stages complete.
  const isGranted = status === "Licence Granted";
  const govActive = ["Government Processing", "Decision Pending", "Approved", "Licence Granted"].includes(status);
  const decisionActive = ["Decision Pending", "Approved", "Licence Granted"].includes(status);
  // Sponsor information provision is done once the application left Pending —
  // either assigned for review or sent back for info.
  const infoProvided = submitted && !["Draft", "Pending"].includes(status);

  const signal = {
    enquiry_onboarding:              true,
    licence_routes:                  (app.routes || []).length > 0,
    organisation_details:            !!(app.organisationInfo && (app.organisationInfo.companiesHouseNumber || app.organisationInfo.organisationType)),
    cos_requirements:                (app.cosRequirements || []).length > 0,
    supporting_documents:            docsComplete,
    key_personnel:                   !!app.authorisingOfficer,
    declarations:                    !!(app.declaration && app.declaration.accuracyConfirmed),
    intake_information_form:         infoProvided,
    intake_document_checklist:       govActive,
    sponsor_information_provision:   infoProvided,
    government_sms_registration:     govActive,
    sponsor_portal_onboarding:       govActive,
    government_portal_credentials:   govActive,
    government_application_forms:    decisionActive,
    government_submission:           decisionActive,
    // These two are completed manually (no data-signal auto-complete):
    home_office_document_dispatch:   false,
    payment_confirmation:            false,
    submission:                      submitted,
    decision_activation:             status === "Approved" || isGranted,
  };

  if (status === "Approved" || isGranted) {
    LICENCE_STAGE_DEFINITIONS.forEach((s) => completed.add(s.key));
    return { completed, currentKey: null };
  }

  // Completion is CONTIGUOUS: once the first incomplete stage is found, every
  // later stage is "upcoming" even if its own data signal happens to be true.
  // This prevents the timeline from jumping ahead (e.g. marking Submission done
  // while the government stages are still pending) and keeps the backend in sync
  // with the frontend tracker (deriveStageStatuses in constants/licenceStages.js).
  let currentKey = null;
  for (const s of LICENCE_STAGE_DEFINITIONS) {
    if (currentKey) continue;          // a gap was already found — rest are upcoming
    if (signal[s.key]) completed.add(s.key);
    else currentKey = s.key;           // first incomplete stage = the active one
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
  const autoComplete = roleAutoCompletes(role, completed.has(stage.key), application.status, stage.key);

  const slaDays = STAGE_SLA_DAYS[stage.key] ?? null;
  const seedDueDate = slaDays && !autoComplete ? new Date(Date.now() + slaDays * 86_400_000) : null;

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
      dueDate: seedDueDate,
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
    const company = application.companyName || `#LIC-${application.id}`;
    deliver({
      tenantDb,
      recipientUserId: assignee.userId,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      category: "sponsorship",
      title: `Action required — ${stage.title}: ${company}`,
      message: `${taskText} Please log in to your portal to complete this task.`,
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

  // If the just-created task was immediately auto-completed, send notification and keep chain moving.
  if (result?.isNew && result.wasAutoCompleted) {
    try {
      await notifyStageTaskCompleted({
        tenantDb,
        application,
        stageDef: next.stageDef,
        role: next.role,
        task: result.row,
        actorUser: null,
        req: ctx.req,
      }).catch((err) =>
        logger.warn({ err, stageKey: next.stageDef.key, role: next.role }, "seedNextInChain: notification failed"),
      );
    } catch (err) {
      logger.warn({ err }, "seedNextInChain: notify wrapper error");
    }
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
  const { completed, currentKey } = deriveStageCompletion(appShape);
  const recipients = await resolveRoleRecipients(tenantDb, application);
  const ctx = { org, completed, recipients, req };

  // Terminal: seed every chain node so the history panel is fully populated.
  if (["Approved", "Licence Granted", "Rejected", "Licence Rejected"].includes(application.status)) {
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
    attributes: ["stageKey", "role", "status", "id"],
    order: [["stageOrder", "ASC"]],
  });

  const rowStatus = new Map(
    existingRows.map((r) => [`${r.stageKey}:${r.role}`, r.status]),
  );

  // Fix data/DB mismatch: auto-complete pending tasks for stages that are already complete
  // in the data signal. This unblocks the chain when old applications have incomplete task
  // rows but the data already satisfies the completion criteria.
  const { Op } = tenantDb.Sequelize;
  for (const stageKey of completed.keys()) {
    const incompleteTasks = existingRows.filter(
      (r) => r.stageKey === stageKey &&
             r.status !== "completed" &&
             roleAutoCompletes(r.role, true, application.status, r.stageKey)
    );
    if (incompleteTasks.length > 0) {
      await tenantDb.LicenceStageTask.update(
        { status: "completed", completedAt: new Date() },
        { where: { id: { [Op.in]: incompleteTasks.map((t) => t.id) } } },
      ).catch((err) =>
        logger.warn({ err, stageKey, count: incompleteTasks.length }, "ensureStageTasks: auto-complete fix failed"),
      );
    }
  }

  // Special case: intake_information_form tasks (sponsor + caseworker) auto-complete
  // when the sponsor has submitted their intake form (form.isComplete = true), even if
  // the application status hasn't yet advanced past "Pending". The data signal in
  // deriveStageCompletion uses application status as a proxy, but the actual intake form
  // lives in a separate table not included in the V2 serializer shape.
  //
  // Caseworker task: "review the information form" is an acknowledgement step —
  // the caseworker's real manual work is document verification (stage 10). Auto-completing
  // it unblocks checkSequentialOrder so the caseworker can proceed to stage 10.
  const pendingIntakeInfoTasks = existingRows.filter(
    (r) => r.stageKey === "intake_information_form" && r.status !== "completed"
  );
  if (pendingIntakeInfoTasks.length > 0 && tenantDb.LicenceIntakeForm) {
    try {
      const intakeForm = await tenantDb.LicenceIntakeForm.findOne({
        where: { licenceApplicationId: application.id, isComplete: true },
        attributes: ["id"],
      });
      if (intakeForm) {
        await tenantDb.LicenceStageTask.update(
          { status: "completed", completedAt: new Date() },
          { where: { id: { [Op.in]: pendingIntakeInfoTasks.map((t) => t.id) } } }
        );
      }
    } catch (err) {
      logger.warn({ err }, "ensureStageTasks: intake_information_form auto-complete check failed");
    }
  }

  // Government pipeline repair: auto-complete stage tasks whose corresponding
  // real-world action has already been taken (evidenced by tracking data or
  // application status) but whose task rows are still pending — typically because
  // the earlier completeStageTask(.catch) call silently failed due to an upstream
  // sequential-order violation that has since been resolved.
  if (tenantDb.LicenceGovernmentTracking) {
    try {
      const appStatus = application.status;
      const reviewStatuses = ["Under Review", "Information Requested", "Government Processing", "Decision Pending", "Approved"];
      const govStatuses    = ["Government Processing", "Decision Pending", "Approved"];

      const tracking = await tenantDb.LicenceGovernmentTracking.findOne({
        where: { licenceApplicationId: application.id },
        attributes: [
          "smsRegistrationRef",
          "credentialsGeneratedAt",
          "credentialsSentAt",
          "ukviCredentialsSubmittedAt",
          "homeOfficeDocsSentAt",
        ],
      });

      // Build a list of (stageKey, role) pairs that should be force-completed.
      const toForce = [];
      const isPending = (key, role) => {
        const s = existingRows.find((r) => r.stageKey === key && r.role === role);
        return s && s.status !== "completed";
      };

      // stage 11 — sponsor_information_provision
      if (reviewStatuses.includes(appStatus)) {
        if (isPending("sponsor_information_provision", "sponsor"))    toForce.push("sponsor_information_provision:sponsor");
        if (isPending("sponsor_information_provision", "caseworker")) toForce.push("sponsor_information_provision:caseworker");
      }
      if (govStatuses.includes(appStatus)) {
        if (isPending("sponsor_information_provision", "admin"))      toForce.push("sponsor_information_provision:admin");
      }

      // stage 12 — government_sms_registration
      if (tracking?.smsRegistrationRef) {
        if (isPending("government_sms_registration", "sponsor"))      toForce.push("government_sms_registration:sponsor");
        if (isPending("government_sms_registration", "caseworker"))   toForce.push("government_sms_registration:caseworker");
        if (isPending("government_sms_registration", "admin"))        toForce.push("government_sms_registration:admin");
      }

      // stage 12 — sponsor_portal_onboarding
      if (tracking?.ukviCredentialsSubmittedAt || tracking?.credentialsSentAt) {
        if (isPending("sponsor_portal_onboarding", "caseworker"))     toForce.push("sponsor_portal_onboarding:caseworker");
        if (isPending("sponsor_portal_onboarding", "admin"))          toForce.push("sponsor_portal_onboarding:admin");
      }
      if (tracking?.ukviCredentialsSubmittedAt) {
        if (isPending("sponsor_portal_onboarding", "sponsor"))        toForce.push("sponsor_portal_onboarding:sponsor");
      }

      // stage 13 — government_portal_credentials (flow v2: sponsor submits first)
      if (tracking?.ukviCredentialsSubmittedAt) {
        if (isPending("government_portal_credentials", "sponsor"))    toForce.push("government_portal_credentials:sponsor");
      }
      if (tracking?.credentialsGeneratedAt || tracking?.ukviCredentialsSubmittedAt) {
        if (isPending("government_portal_credentials", "caseworker")) toForce.push("government_portal_credentials:caseworker");
        if (isPending("government_portal_credentials", "admin"))      toForce.push("government_portal_credentials:admin");
      }

      // stages 14-15 + 18 — once the application reaches Decision Pending, these
      // government-application and submission stage tasks are implicitly done.
      const decisionStatuses = ["Decision Pending", "Approved"];
      if (decisionStatuses.includes(appStatus)) {
        // stage 14 — government_application_forms
        if (isPending("government_application_forms", "sponsor"))    toForce.push("government_application_forms:sponsor");
        if (isPending("government_application_forms", "caseworker")) toForce.push("government_application_forms:caseworker");
        if (isPending("government_application_forms", "admin"))      toForce.push("government_application_forms:admin");

        // stage 15 — government_submission
        if (isPending("government_submission", "sponsor"))    toForce.push("government_submission:sponsor");
        if (isPending("government_submission", "caseworker")) toForce.push("government_submission:caseworker");
        if (isPending("government_submission", "admin"))      toForce.push("government_submission:admin");

        // stage 18 — submission (final submission acknowledgement)
        if (isPending("submission", "sponsor"))    toForce.push("submission:sponsor");
        if (isPending("submission", "caseworker")) toForce.push("submission:caseworker");
        if (isPending("submission", "admin"))      toForce.push("submission:admin");
      }

      // stage 16 — home_office_document_dispatch: repair when docs already sent
      if (tracking?.homeOfficeDocsSentAt) {
        if (isPending("home_office_document_dispatch", "caseworker")) toForce.push("home_office_document_dispatch:caseworker");
        if (isPending("home_office_document_dispatch", "admin"))      toForce.push("home_office_document_dispatch:admin");
        if (isPending("home_office_document_dispatch", "sponsor"))    toForce.push("home_office_document_dispatch:sponsor");
      }

      // stage 17 — payment_confirmation: repair when sponsor already confirmed
      if (application.ukviPaymentConfirmedAt) {
        if (isPending("payment_confirmation", "sponsor"))    toForce.push("payment_confirmation:sponsor");
        if (isPending("payment_confirmation", "caseworker")) toForce.push("payment_confirmation:caseworker");
        if (isPending("payment_confirmation", "admin"))      toForce.push("payment_confirmation:admin");
      }

      if (toForce.length > 0) {
        const ids = existingRows
          .filter((r) => toForce.includes(`${r.stageKey}:${r.role}`))
          .map((r) => r.id);
        if (ids.length > 0) {
          await tenantDb.LicenceStageTask.update(
            { status: "completed", completedAt: new Date() },
            { where: { id: { [Op.in]: ids } } }
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "ensureStageTasks: government pipeline repair failed");
    }
  }

  // Self-heal: a sponsor "payment confirmation" task that was completed by someone
  // OTHER than the sponsor (e.g. an admin/caseworker ticked it by mistake before this
  // was locked down) while the sponsor has NOT actually confirmed the UKVI fee payment
  // (ukviPaymentConfirmedAt is null) is reopened — only the sponsor may confirm payment.
  // A genuine sponsor confirmation always sets ukviPaymentConfirmedAt first (and is
  // completedByUserId === the sponsor), so this never reverts a legitimate completion.
  if (!application.ukviPaymentConfirmedAt) {
    const sponsorPayment = await tenantDb.LicenceStageTask.findOne({
      where: {
        licenceApplicationId: application.id,
        stageKey: "payment_confirmation",
        role: "sponsor",
        status: "completed",
      },
      attributes: ["id", "completedByUserId"],
    });
    if (sponsorPayment && sponsorPayment.completedByUserId !== application.userId) {
      await tenantDb.LicenceStageTask.update(
        { status: "pending", completedAt: null, completedByUserId: null },
        { where: { id: sponsorPayment.id } },
      ).catch((err) =>
        logger.warn({ err, applicationId: application.id }, "ensureStageTasks: reopen sponsor payment task failed"),
      );
    }
  }

  // Re-fetch after potential updates
  const freshRows = await tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: application.id },
    attributes: ["stageKey", "role", "status"],
    order: [["stageOrder", "ASC"]],
  });

  const freshRowStatus = new Map(
    freshRows.map((r) => [`${r.stageKey}:${r.role}`, r.status]),
  );

  for (const { stageDef, role } of TASK_CHAIN) {
    const status = freshRowStatus.get(`${stageDef.key}:${role}`);
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
    // Row is pending or was just seeded. If this stage is the current active stage
    // (or we have reached the active stage frontier), we stop.
    const currentOrder = currentKey ? (STAGE_BY_KEY[currentKey]?.order ?? 0) : 0;
    if (stageDef.order >= currentOrder) {
      break;
    }
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
// Stages where the sponsor must take an active manual action.
// Auto-completing these would bypass the required sponsor confirmation step.
const SPONSOR_MANUAL_STAGES = new Set(["payment_confirmation"]);

function roleAutoCompletes(role, dataComplete, appStatus, stageKey) {
  if (appStatus === "Approved" || appStatus === "Licence Granted") return true;
  // Sponsor/candidate tasks for stages requiring manual sponsor action must NOT
  // auto-complete — the sponsor must click a button to confirm.
  if ((role === "sponsor" || role === "candidate") && SPONSOR_MANUAL_STAGES.has(stageKey)) return false;
  // Other sponsor/candidate tasks auto-complete from data signals.
  // Caseworker and admin review tasks must always be completed by a human.
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
  const { completed } = deriveStageCompletion(appShape);
  const rejected = application.status === "Rejected" || application.status === "Licence Rejected";

  const rows = await tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: application.id },
    order: [["stageOrder", "ASC"], ["id", "ASC"]],
  });

  const byStage = new Map();
  for (const r of rows) {
    if (!byStage.has(r.stageKey)) byStage.set(r.stageKey, []);
    byStage.get(r.stageKey).push(r);
  }

  // Supplement the data-signal completed set with DB task-row state for ALL stages.
  // This prevents stage regression when the status is "Licence Rejected" — deriveStageCompletion
  // has no data signal for govActive stages (9-15) under that status, so without this supplement
  // the contiguous scan stops at stage 9. Any stage whose DB task rows are all completed
  // is treated as done regardless of whether a data signal fired.
  for (const s of LICENCE_STAGE_DEFINITIONS) {
    if (completed.has(s.key)) continue;
    const stageRows = byStage.get(s.key) || [];
    if (stageRows.length > 0 && stageRows.every((r) => r.status === "completed")) {
      completed.add(s.key);
    }
  }
  // Recalculate currentKey now that completed may have grown (contiguous from start).
  let currentKey = null;
  for (const s of LICENCE_STAGE_DEFINITIONS) {
    if (!completed.has(s.key)) { currentKey = s.key; break; }
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
        const active = t.status === "pending" || t.status === "in_progress";
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
          waitingSince: active ? t.createdAt : null,
          slaStatus: active ? computeSlaStatus(t.dueDate) : null,
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
        waitingSince: null,
        slaStatus: null,
      };
    });

    // Stage-level ownership: first task that is actively awaiting action.
    const firstActive = tasks.find((t) => t.id !== null && (t.status === "pending" || t.status === "in_progress")) ?? null;

    let stageStatus = completed.has(def.key) ? "completed" : def.key === currentKey ? "in_progress" : "pending";
    if (rejected && def.key === "decision_activation") stageStatus = "rejected";
    return {
      key: def.key, order: def.order, title: def.title, govSection: def.govSection, status: stageStatus, tasks,
      // Ownership summary — displayed in the stage header / ownership panel.
      currentOwner:        firstActive?.role        ?? null,
      currentAssigneeName: firstActive?.assigneeName ?? null,
      waitingSince:        firstActive?.waitingSince  ?? null,
      dueDate:             firstActive?.dueDate       ?? null,
      slaStatus:           firstActive?.slaStatus     ?? null,
    };
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

function canCompleteRole(actorUser, role, stageKey) {
  const key = actorRoleKey(actorUser);
  // Sponsor-manual stages (e.g. payment confirmation) must be completed by the
  // sponsor themselves — staff cannot tick them off on the sponsor's behalf,
  // because the sponsor is attesting to a real-world action (the UKVI fee payment).
  if (role === "sponsor" && SPONSOR_MANUAL_STAGES.has(stageKey)) {
    return key === "sponsor";
  }
  if (key === "admin") return true; // admins may complete any other role's task
  // Caseworkers may complete sponsor and caseworker tasks to drive the workflow
  // (only on applications they're assigned to — enforced by ensureAssignedCaseworker),
  // but NOT admin tasks: admin sign-off stays admin-only. Stage ordering still applies.
  if (key === "caseworker") return role !== "admin";
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
  if (!canCompleteRole(actorUser, role, stageKey)) {
    const e = new Error("You are not permitted to complete this task"); e.statusCode = 403; throw e;
  }

  const application = await tenantDb.LicenceApplication.findByPk(applicationId);
  if (!application) {
    const e = new Error("Licence application not found"); e.statusCode = 404; throw e;
  }

  // Phase gate: certain government-pipeline stages require the application to
  // have reached a specific status before any role can act on them.
  checkStatusGate(application, stageDef);

  const taskWhere = { licenceApplicationId: applicationId, stageKey, role };

  await ensureStageTasks(tenantDb, application, { req });

  let task = await tenantDb.LicenceStageTask.findOne({ where: taskWhere });

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

  // Sequential + within-stage ordering enforcement.
  //   - Sequential: all of this role's earlier-stage tasks must be completed
  //     before this task. Other roles' earlier-stage tasks do not block — each
  //     role advances through their own chain independently.
  //   - Intra-stage: earlier roles in the stage's execution order must complete
  //     their task before later roles can complete theirs.
  //
  // These checks read predecessor task rows that a CONCURRENT request may be
  // updating at the same instant — e.g. a parallel stages-panel refresh running
  // ensureStageTasks (which auto-completes/repairs predecessors), or another
  // role completing their task. A first click could then see a predecessor as
  // still-pending and 409, while an immediate second click succeeds. To remove
  // that flakiness, on a 409 we re-run the seeding/repair pass and re-read once
  // before surfacing the error. A genuinely-incomplete predecessor still fails
  // the re-check, so this never yields a false completion.
  try {
    await checkSequentialOrder(tenantDb, applicationId, stageDef, role);
    await checkIntraStageOrder(tenantDb, applicationId, stageDef, role);
  } catch (err) {
    if (err?.statusCode !== 409) throw err;
    await ensureStageTasks(tenantDb, application, { req });
    const refreshed = await tenantDb.LicenceStageTask.findOne({ where: taskWhere });
    if (refreshed?.status === "completed") return refreshed; // completed concurrently
    if (refreshed) task = refreshed;
    // Re-validate against the freshly-repaired state; a real ordering violation
    // throws again here and is returned to the caller as a legitimate 409.
    await checkSequentialOrder(tenantDb, applicationId, stageDef, role);
    await checkIntraStageOrder(tenantDb, applicationId, stageDef, role);
  }

  // Ensure actor is mirrored in tenant DB to avoid foreign key constraint violations
  if (actorUser && tenantDb) {
    const actorIdForSync = actorUser.id ?? actorUser.userId;
    if (actorIdForSync) {
      try {
        const exists = await tenantDb.User.findByPk(actorIdForSync, { attributes: ["id"] });
        if (!exists) {
          const { mirrorUserToTenant } = await import("./userSync.service.js");
          await mirrorUserToTenant(tenantDb, actorUser);
        }
      } catch (err) {
        logger.error({ err, actorId: actorIdForSync }, "completeStageTask: failed to mirror actor to tenant DB");
      }
    }
  }

  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
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
 * Build audience-specific title + message for a stage-completion notification.
 * Each party gets a message that tells them what happened AND what they should do next.
 */
function stageCompletionContent({ stageDef, role, company, audience }) {
  const nextStageDef = (() => {
    const idx = LICENCE_STAGE_DEFINITIONS.findIndex((s) => s.key === stageDef.key);
    return idx >= 0 ? LICENCE_STAGE_DEFINITIONS[idx + 1] : null;
  })();
  const nextHint = nextStageDef ? ` Next stage: ${nextStageDef.title}.` : " This was the final stage.";

  if (audience === "sponsor") {
    if (role === "sponsor") {
      return {
        title: `Stage submitted: ${stageDef.title}`,
        message: `Your submission for the "${stageDef.title}" stage has been recorded for ${company}. Your case team will review and take the next action.`,
      };
    }
    return {
      title: `Application update — ${stageDef.title}: ${company}`,
      message: `Your case team has completed the "${stageDef.title}" stage for your licence application (${company}).${nextHint} Log in to your portal to track progress.`,
    };
  }

  if (audience === "caseworker" || audience === "admin") {
    if (role === "sponsor") {
      return {
        title: `Action required — ${stageDef.title}: ${company}`,
        message: `The sponsor has completed the "${stageDef.title}" stage for ${company}. Please review and complete your assigned action.${nextHint}`,
      };
    }
    const actor = role.charAt(0).toUpperCase() + role.slice(1);
    return {
      title: `Stage progressed — ${stageDef.title}: ${company}`,
      message: `${actor} has completed the "${stageDef.title}" stage for ${company}.${nextHint}`,
    };
  }

  // Candidate (email-only)
  return {
    title: `Application update: ${stageDef.title}`,
    message: `The sponsor licence application for ${company} has progressed — the "${stageDef.title}" stage is now complete.`,
  };
}

/**
 * Fan a "task completed" event across in-app + email to the parties who care
 * (tenant admin, sponsor owner, assigned caseworkers, and the candidate by
 * email), skipping the actor. Each audience receives a specific, actionable
 * message. The audit row is written atomically by completeStageTask() before
 * this function is called; it is not re-written here.
 */
async function notifyStageTaskCompleted({ tenantDb, application, stageDef, role, task, actorUser, req }) {
  const recipients = await resolveRoleRecipients(tenantDb, application);
  const org = application.organisationId ?? req?.user?.organisation_id ?? null;
  const actorId = actorUser?.userId ?? null;
  const company = application.companyName || `#LIC-${application.id}`;

  const targets = [];
  if (recipients.admin?.userId) targets.push({ ...recipients.admin, audience: "admin" });
  if (recipients.sponsor?.userId) targets.push({ ...recipients.sponsor, audience: "sponsor" });
  for (const cw of recipients.caseworkers) {
    if (cw.userId) targets.push({ ...cw, audience: "caseworker" });
  }
  // Candidate is a free-text CoS contact (no portal user) — email only.
  if (recipients.candidate?.email) targets.push({ ...recipients.candidate, audience: "candidate" });

  const seenUsers = new Set();
  const seenEmails = new Set();
  for (const t of targets) {
    if (t.userId) {
      if (t.userId === actorId || seenUsers.has(t.userId)) continue;
      seenUsers.add(t.userId);
    } else {
      if (!t.email || seenEmails.has(t.email)) continue;
      seenEmails.add(t.email);
    }

    const { title, message } = stageCompletionContent({ stageDef, role, company, audience: t.audience });

    await deliver({
      tenantDb,
      recipientUserId: t.userId || null,
      recipientEmail: t.email,
      recipientName: t.name || "there",
      type: t.audience === "sponsor" ? NotificationTypes.SUCCESS : NotificationTypes.INFO,
      priority: role === "sponsor" && (t.audience === "caseworker" || t.audience === "admin")
        ? NotificationPriority.HIGH
        : NotificationPriority.MEDIUM,
      category: "sponsorship",
      title,
      message,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_stage_task_completed",
      actionUrl: actionUrlForAudience(t.audience),
      audit: null,
      req,
      organisationId: org,
    }).catch((err) =>
      logger.warn(
        { err, applicationId: application.id, stageKey: stageDef.key, role, audience: t.audience },
        "notifyStageTaskCompleted: deliver failed — task still complete, remaining recipients will still be notified",
      ),
    );
  }

  // Push a lightweight socket event to every portal user so their page can
  // re-fetch without a manual refresh.
  const livePayload = { applicationId: application.id, stageKey: stageDef.key };
  if (recipients.sponsor?.userId)  emitToUser(recipients.sponsor.userId,  EVENT_TYPES.LICENCE_STAGE_UPDATED, livePayload);
  if (recipients.admin?.userId)    emitToUser(recipients.admin.userId,    EVENT_TYPES.LICENCE_STAGE_UPDATED, livePayload);
  for (const cw of recipients.caseworkers) {
    if (cw.userId) emitToUser(cw.userId, EVENT_TYPES.LICENCE_STAGE_UPDATED, livePayload);
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
