import { Op } from "sequelize";
import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyAdmins,
  notifyCaseAssigned,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateNotificationEmailTemplate } from "../utils/emailTemplates.js";

const CASEWORKER_ROLE_ID = 2;

/** Statuses that no longer count towards a caseworker's open workload. */
export const TERMINAL_CASE_STATUSES = ["Completed", "Cancelled", "Closed", "Rejected"];

/**
 * Pick the least-loaded active caseworker (fewest open cases).
 *
 * Returns the caseworker (with `openCases`), or null when no active caseworker
 * exists — in which case the caller should place the case in the unassigned
 * queue (Option B).
 */
export async function pickLeastLoadedCaseworker(tenantDb, { transaction } = {}) {
  const caseworkers = await tenantDb.User.findAll({
    where: { role_id: CASEWORKER_ROLE_ID, status: "active" },
    attributes: ["id", "first_name", "last_name", "email"],
    transaction,
  });
  if (!caseworkers.length) return null;

  const loads = await Promise.all(
    caseworkers.map((cw) =>
      tenantDb.Case.count({
        where: {
          assignedcaseworkerId: { [Op.contains]: [cw.id] },
          status: { [Op.notIn]: TERMINAL_CASE_STATUSES },
        },
        transaction,
      })
    )
  );

  let best = 0;
  for (let i = 1; i < loads.length; i++) {
    if (loads[i] < loads[best]) best = i;
  }
  return { ...caseworkers[best].get({ plain: true }), openCases: loads[best] };
}

/**
 * After a sponsored-worker immigration case is created, write the assignment
 * audit log and notify the right people:
 *   - assigned: notify the caseworker the case was routed to;
 *   - unassigned: alert admins that the case is sitting in the queue.
 * Best effort — never throws (runs after the worker-creation transaction commits).
 */
export async function recordCaseAssignmentOutcome({
  tenantDb,
  caseRecord,
  caseworker = null,
  assignedCaseworkerId = null,
  sponsorId = null,
  actorId = null,
  candidateName = "the worker",
  req = null,
  emailService = null,
}) {
  let resolvedCw = caseworker;
  if (!resolvedCw && assignedCaseworkerId) {
    resolvedCw = await tenantDb.User.findByPk(assignedCaseworkerId, {
      attributes: ['id', 'email', 'first_name', 'last_name', 'organisation_id'],
    }).catch(() => null);
  }

  const assigned = !!resolvedCw;

  await recordAuditLog({
    tenantDb,
    userId: actorId,
    action: assigned ? "CASE_AUTO_ASSIGNED" : "CASE_UNASSIGNED_QUEUE",
    resource: "case",
    status: "Success",
    details: JSON.stringify({
      caseId: caseRecord.caseId,
      caseRowId: caseRecord.id,
      candidateId: caseRecord.candidateId,
      sponsorId,
      assignedCaseworkerId: caseworker?.id ?? null,
      caseworkerOpenCases: caseworker?.openCases ?? null,
    }),
    req,
    organisationId: caseRecord.organisation_id ?? null,
  }).catch((err) => logger.error({ err, caseId: caseRecord?.caseId, caseRowId: caseRecord?.id }, "Failed to audit case assignment"));

  if (assigned) {
    // Event 10 — Immigration Case Created: in-app + professional email to the caseworker.
    try {
      const notification = await notifyCaseAssigned(tenantDb, resolvedCw.id, {
        id: caseRecord.id,
        caseId: caseRecord.caseId,
        candidateName,
        caseworker: resolvedCw,
        organisationId: caseRecord.organisation_id ?? null,
        title: `New Case Assigned: ${candidateName ? `${caseRecord.caseId} - ${candidateName}` : caseRecord.caseId}`,
        message: `A new sponsored-worker immigration case (${candidateName}) has been assigned to you. Review can begin.`,
        emailService,
      });
      if (!notification) {
        logger.error({ caseId: caseRecord?.caseId, caseworkerId: resolvedCw.id }, "Failed to persist in-app assignment notification");
      }
    } catch (err) {
      logger.error({ err, caseId: caseRecord?.caseId, caseworkerId: resolvedCw.id }, "Failed to notify assigned caseworker");
    }
  } else {
    try {
      await notifyAdmins(tenantDb, {
        type: NotificationTypes.WARNING,
        priority: NotificationPriority.HIGH,
        title: "Immigration Case Needs Assignment",
        message: `Case ${caseRecord.caseId} (${candidateName}) was created but no active caseworker is available — it is in the unassigned queue.`,
        actionType: "case_unassigned",
        entityType: "case",
        entityId: caseRecord.id,
        metadata: { caseId: caseRecord.caseId, sponsorId },
      });
    } catch (err) {
      logger.error({ err }, "Failed to notify admins of unassigned case");
    }
  }
}

/** Dashboard counter — new immigration cases created within the window. */
export async function countNewImmigrationCases(tenantDb, { sinceDays = 7 } = {}) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return tenantDb.Case.count({ where: { created_at: { [Op.gte]: since } } });
}

/** Dashboard counter — open cases currently in the unassigned queue. */
export async function countUnassignedCases(tenantDb) {
  return tenantDb.Case.count({
    where: {
      status: { [Op.notIn]: TERMINAL_CASE_STATUSES },
      [Op.and]: [
        tenantDb.sequelize.literal(
          `("assignedcaseworkerId" IS NULL OR jsonb_array_length("assignedcaseworkerId") = 0)`
        ),
      ],
    },
  });
}
