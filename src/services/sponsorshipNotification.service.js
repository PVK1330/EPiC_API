import logger from "../utils/logger.js";
import { recordAuditLog } from "./audit.service.js";
import {
  notifyUser,
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateNotificationEmailTemplate } from "../utils/emailTemplates.js";

/**
 * Centralized Sponsorship Notification Service.
 *
 * Every sponsorship-management workflow event funnels through `deliver()`, which
 * fans the event out across THREE channels in one call:
 *   1. In-App notification (persisted + socket) to the recipient
 *   2. Email (templated transactional email — guaranteed, bypasses in-app prefs)
 *   3. Audit Log (global tenant audit_logs)
 *
 * Event coverage (where each is emitted):
 *   1.  Sponsor Created          -> sponsorCreated()          [+ credentials email by createSponsor]
 *   2.  Licence Submitted        -> licenceSubmitted()
 *   3.  Licence Assigned         -> licenceAssigned()
 *   4.  Information Requested     -> informationRequested()
 *   5.  Licence Approved         -> licenceActivation.service.activateSponsorLicence()
 *   6.  Licence Rejected         -> licenceRejected() (via licenceStatusChanged)
 *   7.  CoS Requested            -> cosRequest.service.createCosRequest()
 *   8.  CoS Approved             -> cosRequest.service.reviewCosRequest()
 *   9.  Worker Added             -> workerAdded()
 *   10. Immigration Case Created -> caseAssignment.service.recordCaseAssignmentOutcome()
 *   11. Compliance Review Req.    -> complianceReview.service (request_info)
 *   12. Change Request Approved  -> complianceReview.service (approve)
 */

const frontend = () => process.env.FRONTEND_URL || "";

const orgFrom = (req, fallback = null) =>
  req?.user?.organisation_id != null ? Number(req.user.organisation_id) : fallback;

/**
 * Emit one sponsorship event across in-app + email + audit. Each channel is
 * best-effort and isolated — a failure in one never blocks the others or throws.
 */
export async function deliver({
  tenantDb,
  recipientUserId = null,
  recipientEmail = null,
  recipientName = "there",
  type = NotificationTypes.INFO,
  priority = NotificationPriority.MEDIUM,
  category = "sponsorship",
  title,
  message,
  entityType = null,
  entityId = null,
  actionType = null,
  actionUrl = null,
  emailSubject = null,
  inApp = true,
  email = true,
  audit = null,
  req = null,
  organisationId = null,
}) {
  const org = organisationId ?? orgFrom(req);

  // 1) In-app (we send the email ourselves below, so sendEmail:false here).
  if (inApp && recipientUserId) {
    try {
      await notifyUser(tenantDb, recipientUserId, {
        type,
        priority,
        title,
        message,
        category,
        entityType,
        entityId,
        actionType,
        actionUrl,
        organisationId: org,
        sendEmail: false,
      });
    } catch (err) {
      logger.error({ err }, "sponsorship deliver: in-app failed");
    }
  }

  // 2) Email (templated, guaranteed).
  if (email) {
    try {
      let to = recipientEmail;
      let name = recipientName;
      if (!to && recipientUserId) {
        const u = await tenantDb.User.findByPk(recipientUserId, { attributes: ["email", "first_name"] });
        to = u?.email || null;
        if ((!name || name === "there") && u?.first_name) name = u.first_name;
      }
      if (to) {
        await sendTransactionalEmail({
          organisationId: org,
          to,
          subject: emailSubject || title,
          html: generateNotificationEmailTemplate({
            recipientName: name,
            title,
            message,
            priority,
            notificationType: type,
            actionUrl: actionUrl ? `${frontend()}${actionUrl}` : undefined,
            metadata: { entityType, entityId },
          }),
        });
      }
    } catch (err) {
      logger.error({ err }, "sponsorship deliver: email failed");
    }
  }

  // 3) Audit.
  if (audit) {
    recordAuditLog({
      tenantDb,
      userId: audit.actorId ?? null,
      action: audit.action,
      resource: audit.resource || "sponsorship",
      status: "Success",
      details: JSON.stringify(audit.details || {}),
      req,
      organisationId: org,
    }).catch((err) => logger.error({ err }, "sponsorship deliver: audit failed"));
  }
}

// ─── Event 1: Sponsor Created ────────────────────────────────────────────────
// (The credentials/welcome email is sent by createSponsor; here we add the
// sponsor's in-app welcome and the audit log.)
export async function sponsorCreated({ tenantDb, sponsor, actorId = null, req = null }) {
  await deliver({
    tenantDb,
    recipientUserId: sponsor.id,
    recipientName: sponsor.first_name || "there",
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.HIGH,
    title: "Welcome to the Sponsor Portal",
    message:
      "Your sponsor account has been created. You can now log in, complete your profile and apply for your sponsorship licence.",
    entityType: "sponsor",
    entityId: sponsor.id,
    actionType: "sponsor_created",
    actionUrl: "/business/licence",
    email: false, // credentials email already sent by createSponsor
    audit: { actorId, action: "SPONSOR_CREATED", resource: "sponsor", details: { sponsorId: sponsor.id, email: sponsor.email } },
    req,
    organisationId: sponsor.organisation_id ?? orgFrom(req),
  });
}

// ─── Event 2: Licence Submitted ──────────────────────────────────────────────
export async function licenceSubmitted({ tenantDb, application, req = null }) {
  // Sponsor confirmation (in-app + email) + audit.
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    title: "Licence Application Submitted",
    message: `Your ${application.type || "New"} sponsorship licence application for ${application.companyName} has been submitted and is pending review.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "licence_submitted",
    actionUrl: "/business/licence",
    audit: { action: "LICENCE_SUBMITTED", resource: "licence_application", details: { applicationId: application.id, company: application.companyName } },
    req,
  });
  // Admins (in-app only — audit already recorded above).
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `New Licence Application: ${application.companyName}`,
      message: `${application.contactName} submitted a ${application.type || "New"} licence application.`,
      category: "sponsorship",
      actionType: "new_licence_application",
      entityType: "licence_application",
      entityId: application.id,
    });
  } catch (err) {
    logger.error({ err }, "licenceSubmitted: admin notify failed");
  }
}

// ─── Event 3: Licence Assigned ───────────────────────────────────────────────
export async function licenceAssigned({ tenantDb, application, caseworkers = [], req = null }) {
  // Each assigned caseworker (in-app + email).
  for (const cw of caseworkers) {
    const cwId = typeof cw === "object" ? cw.id : cw;
    if (!cwId) continue;
    await deliver({
      tenantDb,
      recipientUserId: cwId,
      recipientEmail: cw?.email || null,
      recipientName: cw?.first_name || "there",
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `Licence Application Assigned: #LIC-${application.id}`,
      message: `You have been assigned licence application #LIC-${application.id} (${application.companyName}) to review.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_assigned",
      actionUrl: "/caseworker/licence-reviews",
      req,
    });
  }
  // Sponsor: now under review.
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    title: "Licence Application Under Review",
    message: `Your licence application for ${application.companyName} has been assigned to a caseworker and is now under review.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "licence_under_review",
    actionUrl: "/business/licence",
    req,
  });
}

// ─── Event 4: Information Requested ───────────────────────────────────────────
export async function informationRequested({ tenantDb, application, adminNotes = null, req = null }) {
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    title: "More Information Requested",
    message: `Additional information is required for your licence application (${application.companyName}).${adminNotes ? ` Note: ${adminNotes}` : ""} Please respond via the portal.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "licence_information_requested",
    actionUrl: "/business/licence",
    req,
  });
}

// ─── Event 6: Licence Rejected ───────────────────────────────────────────────
export async function licenceRejected({ tenantDb, application, adminNotes = null, req = null }) {
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.ERROR,
    priority: NotificationPriority.HIGH,
    title: "Licence Application Rejected",
    message: `Your sponsorship licence application for ${application.companyName} has been rejected.${adminNotes ? ` Reason: ${adminNotes}` : ""}`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "licence_rejected",
    actionUrl: "/business/licence",
    req,
  });
}

/**
 * Generic licence status-change notifier used by the review controllers.
 * Routes to the right event; Approved is skipped here because licence
 * activation (event 5) sends its own notification.
 */
export async function licenceStatusChanged({ tenantDb, application, status, adminNotes = null, req = null }) {
  switch (status) {
    case "Approved":
      return; // handled by activateSponsorLicence (event 5)
    case "Rejected":
      return licenceRejected({ tenantDb, application, adminNotes, req });
    case "Information Requested":
      return informationRequested({ tenantDb, application, adminNotes, req });
    case "Under Review":
      return deliver({
        tenantDb,
        recipientUserId: application.userId,
        type: NotificationTypes.INFO,
        priority: NotificationPriority.MEDIUM,
        title: "Licence Application Under Review",
        message: `Your licence application for ${application.companyName} is now under review.`,
        entityType: "licence_application",
        entityId: application.id,
        actionType: "licence_under_review",
        actionUrl: "/business/licence",
        req,
      });
    default:
      return deliver({
        tenantDb,
        recipientUserId: application.userId,
        type: NotificationTypes.INFO,
        priority: NotificationPriority.MEDIUM,
        title: "Licence Application Updated",
        message: `The status of your licence application for ${application.companyName} is now "${status}".`,
        entityType: "licence_application",
        entityId: application.id,
        actionType: "licence_status_changed",
        actionUrl: "/business/licence",
        req,
      });
  }
}

// ─── Event 9: Worker Added ───────────────────────────────────────────────────
// (Worker credentials email + admin notify happen in addSponsoredWorker; here we
// add the sponsor's confirmation and the audit log.)
export async function workerAdded({ tenantDb, sponsorId, workerName, caseId, req = null }) {
  await deliver({
    tenantDb,
    recipientUserId: sponsorId,
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.MEDIUM,
    title: "Sponsored Worker Added",
    message: `${workerName} has been added as a sponsored worker. Immigration case ${caseId} has been created and routed for review.`,
    entityType: "case",
    entityId: null,
    actionType: "worker_added",
    actionUrl: "/business/workers",
    audit: { action: "WORKER_ADDED", resource: "sponsored_worker", details: { sponsorId, workerName, caseId } },
    req,
  });
}
