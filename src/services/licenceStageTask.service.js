import logger from "../utils/logger.js";
import { ROLES } from "../middlewares/role.middleware.js";
import { deliver } from "./sponsorshipNotification.service.js";
import { recordAuditLog } from "./audit.service.js";
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

// ─── Seeding & assignee sync ────────────────────────────────────────────────────

/** Seed/update all role tasks for a single stage definition. */
async function seedStageRows(tenantDb, application, stage, { org, completed, recipients }) {
  const rows = [];
  let failures = 0;
  for (const role of STAGE_ROLE_KEYS) {
    const taskText = stage.tasks[role];
    if (!taskText) continue;
    try {
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
        const patch = {};
        if (assignee?.userId != null && row.assignedToUserId !== assignee.userId) {
          patch.assignedToUserId = assignee.userId;
          patch.assigneeName = assignee.name ?? null;
          patch.assigneeEmail = assignee.email ?? null;
        } else if (assignee && row.assignedToUserId == null && (assignee.name || assignee.email)) {
          // Only write if the value actually changes (avoids a DB write every call
          // when the placeholder is already stored and no caseworker is assigned).
          const newName  = assignee.name  ?? null;
          const newEmail = assignee.email ?? null;
          if (newName  !== row.assigneeName)  patch.assigneeName  = newName;
          if (newEmail !== row.assigneeEmail) patch.assigneeEmail = newEmail;
        }
        if (row.status !== "completed" && autoComplete) {
          patch.status = "completed";
          patch.completedAt = new Date();
        }
        if (Object.keys(patch).length) await row.update(patch);
      }
      rows.push(row);
    } catch (err) {
      failures += 1;
      logger.error({ err, applicationId: application.id, stageKey: stage.key, role }, "seedStageRows: row failed");
    }
  }
  if (failures) logger.warn({ applicationId: application.id, failures, stageKey: stage.key }, "seedStageRows: completed with failures");
  return rows;
}

/**
 * Idempotently seed task rows for the CURRENT active stage only.
 *
 * Stages are unlocked one at a time: the next stage is seeded only after every
 * task in the current stage has been marked completed. For terminal statuses
 * (Approved / Rejected) all remaining stages are seeded at once so the full
 * history is visible in the panel.
 *
 * Safe to call repeatedly — never un-completes a previously completed task and
 * only fills missing assignees.
 *
 * @returns {Promise<Array>} all existing stage-task rows for the application.
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
  const ctx = { org, completed, recipients };

  // For terminal states seed all remaining stages so the full panel is populated.
  const seedAll = ["Approved", "Rejected"].includes(application.status);

  // Load existing rows to decide which stage to unlock next.
  const allRows = await tenantDb.LicenceStageTask.findAll({
    where: { licenceApplicationId: application.id },
    order: [["stageOrder", "ASC"]],
  });
  const byStage = new Map();
  for (const r of allRows) {
    if (!byStage.has(r.stageKey)) byStage.set(r.stageKey, []);
    byStage.get(r.stageKey).push(r);
  }

  if (seedAll) {
    // Seed every stage that doesn't have a full set of rows yet.
    for (const stage of LICENCE_STAGE_DEFINITIONS) {
      await seedStageRows(tenantDb, application, stage, ctx);
    }
  } else {
    // Sequential: walk stages in order and seed the first one that is not yet
    // fully completed. Stages that have all rows completed are skipped.
    for (const stage of LICENCE_STAGE_DEFINITIONS) {
      const stageRows = byStage.get(stage.key) || [];
      const allComplete = stageRows.length > 0 && stageRows.every((r) => r.status === "completed");
      if (allComplete) continue; // already done — advance to next
      // This is the active stage: seed/update it, then stop.
      await seedStageRows(tenantDb, application, stage, ctx);
      break;
    }
  }

  // Return the full current snapshot (re-query so callers always see fresh data).
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
  if (!dataComplete) return false;
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
    const tasks = (byStage.get(def.key) || []).map((t) => ({
      id: t.id,
      role: t.role,
      title: t.title,
      status: t.status,
      assigneeName: t.assigneeName,
      assigneeEmail: t.assigneeEmail,
      assignedToUserId: t.assignedToUserId,
      completedAt: t.completedAt,
      dueDate: t.dueDate,
    }));
    let status = completed.has(def.key) ? "completed" : def.key === currentKey ? "in_progress" : "pending";
    if (rejected && def.key === "decision_activation") status = "rejected";
    return { key: def.key, order: def.order, title: def.title, govSection: def.govSection, status, tasks };
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

  await ensureStageTasks(tenantDb, application, { req });

  const task = await tenantDb.LicenceStageTask.findOne({
    where: { licenceApplicationId: applicationId, stageKey, role },
  });
  if (!task) {
    const e = new Error("Task not found for this stage/role"); e.statusCode = 404; throw e;
  }
  if (task.status === "completed") return task; // idempotent

  await task.update({
    status: "completed",
    completedAt: new Date(),
    completedByUserId: actorUser?.userId ?? null,
  });

  // Notify the parties who care about this progress (best-effort, never throws).
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
 * email), skipping the actor. The audit row is recorded exactly once, decoupled
 * from the notification fan-out.
 */
async function notifyStageTaskCompleted({ tenantDb, application, stageDef, role, task, actorUser, req }) {
  const recipients = await resolveRoleRecipients(tenantDb, application);
  const org = application.organisationId ?? req?.user?.organisation_id ?? null;
  const actorId = actorUser?.userId ?? null;
  const company = application.companyName || `#LIC-${application.id}`;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  // Record the audit exactly once, regardless of who (if anyone) is notified.
  recordAuditLog({
    tenantDb,
    userId: actorId,
    action: "LICENCE_STAGE_TASK_COMPLETED",
    resource: "licence_stage_task",
    status: "Success",
    details: JSON.stringify({ applicationId: application.id, stageKey: stageDef.key, role, taskId: task.id }),
    req,
    organisationId: org,
  }).catch((err) => logger.error({ err }, "notifyStageTaskCompleted: audit failed"));

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
  resolveRoleRecipients,
  ensureStageTasks,
  getStagesForApplication,
  completeStageTask,
};
