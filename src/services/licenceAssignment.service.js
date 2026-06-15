import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";

/** Canonical audit actions for the licence application trail. */
export const LICENCE_AUDIT_ACTIONS = Object.freeze({
  // Core assignment / status actions
  ASSIGN:         "assign",
  REASSIGN:       "reassign",
  APPROVE:        "approve",
  REJECT:         "reject",
  REQUEST_INFO:   "request_info",
  UNDER_REVIEW:   "under_review",
  REVIEW:         "review",
  // Phase 1 — government processing pipeline actions
  REVIEW_STARTED:                      "review_started",
  GOVERNMENT_REGISTRATION_STARTED:     "government_registration_started",
  GOVERNMENT_REGISTRATION_COMPLETED:   "government_registration_completed",
  CREDENTIALS_GENERATED:               "credentials_generated",
  CREDENTIALS_REQUESTED:               "credentials_requested",
  CREDENTIALS_RECEIVED:                "credentials_received",
  GOVERNMENT_FORMS_COMPLETED:          "government_forms_completed",
  GOVERNMENT_SUBMITTED:                "government_submitted",
  DECISION_PENDING:                    "decision_pending",
});

/** Map a licence application status to its audit action. */
export function statusToAuditAction(status) {
  switch (String(status || "")) {
    case "Approved":               return LICENCE_AUDIT_ACTIONS.APPROVE;
    case "Rejected":               return LICENCE_AUDIT_ACTIONS.REJECT;
    case "Information Requested":  return LICENCE_AUDIT_ACTIONS.REQUEST_INFO;
    case "Under Review":           return LICENCE_AUDIT_ACTIONS.REVIEW_STARTED;
    case "Government Processing":  return LICENCE_AUDIT_ACTIONS.GOVERNMENT_REGISTRATION_STARTED;
    case "Decision Pending":       return LICENCE_AUDIT_ACTIONS.DECISION_PENDING;
    default:                       return LICENCE_AUDIT_ACTIONS.REVIEW;
  }
}

/**
 * Normalise the `assignedcaseworkerId` JSONB value (which may be an array of
 * numbers, numeric strings, or objects like {id}/{userId}) into a clean array
 * of positive integers.
 */
export function extractCaseworkerIds(value) {
  let list = value;
  if (!Array.isArray(list)) {
    if (list == null) return [];
    list = [list];
  }
  return list
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (typeof entry === "string" && entry.trim() !== "" && !Number.isNaN(Number(entry))) {
        return Number(entry);
      }
      if (entry && typeof entry === "object") {
        const id = entry.id ?? entry.userId ?? entry.caseworkerId ?? null;
        return id != null ? Number(id) : null;
      }
      return null;
    })
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** True when `caseworkerId` is among the application's assigned caseworkers. */
export function isCaseworkerAssigned(application, caseworkerId) {
  const ids = extractCaseworkerIds(application?.assignedcaseworkerId);
  return ids.includes(Number(caseworkerId));
}

/**
 * Write one licence-application audit row (assignment or reviewer action) and
 * mirror it to the global audit log. Best effort — never throws.
 */
export async function recordLicenceAudit({
  tenantDb,
  application,
  actorId = null,
  action,
  previousStatus = null,
  newStatus = null,
  assignedCaseworkerIds = null,
  notes = null,
  req = null,
}) {
  const organisationId =
    application?.organisationId ??
    (req?.user?.organisation_id != null ? Number(req.user.organisation_id) : null);

  try {
    await tenantDb.LicenceApplicationAudit.create({
      licenceApplicationId: application.id,
      actorId,
      organisationId: Number.isNaN(organisationId) ? null : organisationId,
      action,
      previousStatus,
      newStatus,
      assignedCaseworkerIds,
      notes,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write licence application audit row");
  }

  // Map action tokens to past-tense global audit action names for readability.
  const actionPastTense = {
    [LICENCE_AUDIT_ACTIONS.ASSIGN]:    "LICENCE_ASSIGNED",
    [LICENCE_AUDIT_ACTIONS.REASSIGN]:  "LICENCE_REASSIGNED",
  };
  const globalAction = actionPastTense[action] ?? `LICENCE_${String(action).toUpperCase()}`;

  await recordAuditLog({
    tenantDb,
    userId: actorId,
    action: globalAction,
    resource: "licence_application",
    status: "Success",
    details: JSON.stringify({
      applicationId: application.id,
      previousStatus,
      newStatus,
      assignedCaseworkerIds,
      notes,
    }),
    req,
    organisationId: Number.isNaN(organisationId) ? null : organisationId,
  }).catch((err) =>
    logger.error({ err, applicationId: application.id }, "Failed to mirror licence audit to global log")
  );
}

/**
 * Orchestrator called immediately after a caseworker is assigned to a licence
 * application. Performs two post-assignment side-effects:
 *
 *   1. Records a LICENCE_ASSIGNED entry in the global audit log.
 *   2. Marks the admin's `enquiry_onboarding` stage task as complete — assigning
 *      a caseworker is the final admin action in the intake stage.
 *
 * Uses a dynamic import of licenceStageTask.service.js to avoid the circular
 * static import (licenceStageTask already imports extractCaseworkerIds from here).
 * Both side-effects are best-effort and never throw.
 *
 * @param {object} opts
 * @param {object} opts.tenantDb
 * @param {object} opts.application  - The licence application instance (after save).
 * @param {object} opts.actorUser    - The req.user who performed the assignment (admin).
 * @param {object} [opts.req]
 */
export async function onLicenceAssigned({ tenantDb, application, actorUser, req = null }) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const organisationId =
    application?.organisationId ??
    (req?.user?.organisation_id != null ? Number(req.user.organisation_id) : null);

  // 1. Global audit log — LICENCE_ASSIGNED (past-tense, matches Phase 1 constant).
  await recordAuditLog({
    tenantDb,
    userId: actorId,
    action: "LICENCE_ASSIGNED",
    resource: "licence_application",
    status: "Success",
    details: JSON.stringify({
      applicationId: application.id,
      company: application.companyName,
      newStatus: application.status,
    }),
    req,
    organisationId: Number.isNaN(organisationId) ? null : organisationId,
  }).catch((err) => logger.error({ err, applicationId: application.id }, "onLicenceAssigned: global audit failed"));

  // 2. Complete admin's enquiry_onboarding task (admin opened & assigned — stage done).
  try {
    const { completeStageTask } = await import("./licenceStageTask.service.js");
    await completeStageTask(tenantDb, {
      applicationId: application.id,
      stageKey: "enquiry_onboarding",
      role: "admin",
      actorUser,
      req,
    });
  } catch (err) {
    // Non-fatal — task may not exist yet on legacy applications.
    logger.warn({ err, applicationId: application.id }, "onLicenceAssigned: completeStageTask(enquiry_onboarding, admin) failed");
  }
}

/** Read the full audit trail for an application, newest first. */
export async function getLicenceAuditTrail(tenantDb, applicationId) {
  return tenantDb.LicenceApplicationAudit.findAll({
    where: { licenceApplicationId: applicationId },
    include: [
      {
        model: tenantDb.User,
        as: "actor",
        attributes: ["id", "first_name", "last_name", "email"],
      },
    ],
    order: [["created_at", "DESC"]],
  });
}
