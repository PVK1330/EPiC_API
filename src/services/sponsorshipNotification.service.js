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
 *
 * @param {string} [previousStatus] - Pass the status BEFORE the update so the
 *   router can detect re-submission (Information Requested → Under Review).
 */
export async function licenceStatusChanged({ tenantDb, application, status, previousStatus = null, adminNotes = null, req = null }) {
  switch (status) {
    case "Approved":
      return; // handled by activateSponsorLicence (event 5)
    case "Rejected":
      return licenceRejected({ tenantDb, application, adminNotes, req });
    case "Information Requested":
      return informationRequested({ tenantDb, application, adminNotes, req });
    case "Under Review":
      // When transitioning from Information Requested → Under Review, notify
      // caseworkers/admins that the sponsor has re-submitted. Then also confirm
      // to the sponsor that their application is back under review.
      if (previousStatus === "Information Requested") {
        await informationReceived({ tenantDb, application, req });
      }
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
    case "Government Processing":
      return governmentRegistrationStarted({ tenantDb, application, req });
    case "Decision Pending":
      return deliver({
        tenantDb,
        recipientUserId: application.userId,
        type: NotificationTypes.INFO,
        priority: NotificationPriority.MEDIUM,
        title: "Application Awaiting UKVI Decision",
        message: `Your licence application for ${application.companyName} has been submitted to UKVI and a decision is pending.`,
        entityType: "licence_application",
        entityId: application.id,
        actionType: "licence_decision_pending",
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

// ─── Phase 2 Government Pipeline Events ─────────────────────────────────────
// Events 13–20: Government processing pipeline notifications.
// All use deliver() for in-app + email + audit in one call.

/**
 * Event 13: Review Started — caseworker assigned, application moves to Under Review.
 * Notifies the sponsor (under review) and each assigned caseworker (new assignment).
 * Audit: review_started
 */
export async function reviewStarted({ tenantDb, application, caseworkerIds = [], req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  // Notify sponsor
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    title: "Licence Application Under Review",
    message: `Your licence application for ${company} has been assigned to a caseworker and is now under review.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "licence_review_started",
    actionUrl: "/business/licence",
    audit: {
      actorId: req?.user?.userId ?? null,
      action: "LICENCE_REVIEW_STARTED",
      resource: "licence_application",
      details: { applicationId: application.id, company, caseworkerIds },
    },
    req,
    organisationId: orgFrom(req),
  });
  // Notify each assigned caseworker
  for (const cwId of caseworkerIds) {
    const id = typeof cwId === "object" ? cwId.id : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `Licence Application Assigned: #LIC-${application.id}`,
      message: `You have been assigned to review licence application #LIC-${application.id} (${company}).`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_assigned_to_caseworker",
      actionUrl: "/caseworker/licence-reviews",
      req,
      organisationId: orgFrom(req),
    });
  }
}

/**
 * Event 14: Information Received — sponsor re-submitted after Information Requested.
 * Notifies caseworkers and admins so they can resume review.
 * Audit: information_received
 */
export async function informationReceived({ tenantDb, application, req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  const actorId = req?.user?.userId ?? null;
  const org = orgFrom(req);

  // Notify admins (in-app)
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `Information Resubmitted: #LIC-${application.id}`,
      message: `${company} has resubmitted the requested information. The application is ready for review.`,
      category: "sponsorship",
      actionType: "licence_information_received",
      entityType: "licence_application",
      entityId: application.id,
    });
  } catch (err) {
    logger.error({ err }, "informationReceived: admin notify failed");
  }

  // Notify each assigned caseworker (in-app + email + audit on first one)
  const cwIds = Array.isArray(application.assignedcaseworkerId)
    ? application.assignedcaseworkerId
    : [];
  let auditRecorded = false;
  for (const cwId of cwIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `Information Received: #LIC-${application.id}`,
      message: `${company} has responded to your information request. Please resume your review.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_information_received",
      actionUrl: "/caseworker/licence-reviews",
      audit: auditRecorded ? null : {
        actorId: application.userId,
        action: "LICENCE_INFORMATION_RECEIVED",
        resource: "licence_application",
        details: { applicationId: application.id, company },
      },
      req,
      organisationId: org,
    });
    auditRecorded = true;
  }
}

/**
 * Event 15: Government Registration Started — caseworker initiated SMS portal registration.
 * Notifies sponsor (for awareness) and records audit.
 * Audit: government_registration_started
 */
export async function governmentRegistrationStarted({ tenantDb, application, req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.MEDIUM,
    title: "Government Portal Registration Initiated",
    message: `Your caseworker has begun registering ${company} on the UKVI Sponsorship Management System (SMS). You will be notified when complete.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "government_registration_started",
    actionUrl: "/business/licence-process",
    audit: {
      actorId: req?.user?.userId ?? null,
      action: "LICENCE_GOVERNMENT_REGISTRATION_STARTED",
      resource: "licence_application",
      details: { applicationId: application.id, company },
    },
    req,
    organisationId: orgFrom(req),
  });
}

/**
 * Event 16: Government Registration Completed — SMS portal registration confirmed.
 * Notifies sponsor with the SMS reference number.
 * Audit: government_registration_completed
 */
export async function governmentRegistrationCompleted({ tenantDb, application, smsRef = null, req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.MEDIUM,
    title: "Government Portal Registration Complete",
    message: `${company} has been successfully registered on the UKVI SMS portal.${smsRef ? ` Reference: ${smsRef}.` : ""} Your caseworker will now set up your portal login.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "government_registration_completed",
    actionUrl: "/business/licence-process",
    audit: {
      actorId: req?.user?.userId ?? null,
      action: "LICENCE_GOVERNMENT_REGISTRATION_COMPLETED",
      resource: "licence_application",
      details: { applicationId: application.id, company, smsRef },
    },
    req,
    organisationId: orgFrom(req),
  });
}

/**
 * Event 17: Credentials Generated — UKVI portal credentials created by caseworker.
 * Notifies caseworker (prompt to send) and records audit.
 * Audit: credentials_generated
 */
export async function credentialsGenerated({ tenantDb, application, caseworkerIds = [], req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  const actorId = req?.user?.userId ?? null;
  const org = orgFrom(req);
  let auditRecorded = false;

  for (const cwId of caseworkerIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: `Portal Credentials Ready: #LIC-${application.id}`,
      message: `UKVI portal credentials have been generated for ${company}. Please send them securely to the sponsor.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "credentials_generated",
      actionUrl: "/caseworker/licence-reviews",
      audit: auditRecorded ? null : {
        actorId,
        action: "LICENCE_CREDENTIALS_GENERATED",
        resource: "licence_application",
        details: { applicationId: application.id, company },
      },
      req,
      organisationId: org,
    });
    auditRecorded = true;
  }
}

/**
 * Event 18: Government Credentials Requested — credentials sent to sponsor for use.
 * Notifies sponsor that credentials are ready and how to access them.
 * Audit: credentials_requested
 */
export async function governmentCredentialsRequested({ tenantDb, application, req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.INFO,
    priority: NotificationPriority.HIGH,
    title: "UKVI Portal Credentials Ready",
    message: `Your UKVI online application portal credentials for ${company} have been sent to you securely. Please confirm receipt via the portal.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "government_credentials_requested",
    actionUrl: "/business/licence-process",
    audit: {
      actorId: req?.user?.userId ?? null,
      action: "LICENCE_CREDENTIALS_REQUESTED",
      resource: "licence_application",
      details: { applicationId: application.id, company },
    },
    req,
    organisationId: orgFrom(req),
  });
}

/**
 * Event 19: Government Credentials Received — sponsor confirmed receipt.
 * Notifies caseworkers and admins so they can proceed to form completion.
 * Audit: credentials_received
 */
export async function governmentCredentialsReceived({ tenantDb, application, req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  const actorId = req?.user?.userId ?? null;
  const org = orgFrom(req);

  // Notify admins
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title: `Credentials Confirmed: #LIC-${application.id}`,
      message: `${company} has confirmed receipt of UKVI portal credentials. Application forms can now be completed.`,
      category: "sponsorship",
      actionType: "government_credentials_received",
      entityType: "licence_application",
      entityId: application.id,
    });
  } catch (err) {
    logger.error({ err }, "governmentCredentialsReceived: admin notify failed");
  }

  // Notify caseworkers
  const cwIds = Array.isArray(application.assignedcaseworkerId)
    ? application.assignedcaseworkerId
    : [];
  let auditRecorded = false;
  for (const cwId of cwIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.MEDIUM,
      title: `Credentials Confirmed by Sponsor: #LIC-${application.id}`,
      message: `${company} has confirmed receipt of UKVI portal credentials. Proceed to completing the government application forms.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "government_credentials_received",
      actionUrl: "/caseworker/licence-reviews",
      audit: auditRecorded ? null : {
        actorId,
        action: "LICENCE_CREDENTIALS_RECEIVED",
        resource: "licence_application",
        details: { applicationId: application.id, company },
      },
      req,
      organisationId: org,
    });
    auditRecorded = true;
  }
}

/**
 * Event 20: Government Application Submitted — application formally submitted to UKVI.
 * Notifies sponsor (confirmation) and caseworkers (submitted — now awaiting decision).
 * Audit: government_submitted
 */
export async function governmentApplicationSubmitted({ tenantDb, application, submissionRef = null, req = null }) {
  const company = application.companyName || `#LIC-${application.id}`;
  const actorId = req?.user?.userId ?? null;
  const org = orgFrom(req);

  // Sponsor notification
  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.HIGH,
    title: "Sponsor Licence Application Submitted to UKVI",
    message: `Your sponsorship licence application for ${company} has been formally submitted to UKVI.${submissionRef ? ` Submission reference: ${submissionRef}.` : ""} A decision is now pending — you will be notified of the outcome.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "government_application_submitted",
    actionUrl: "/business/licence-process",
    audit: {
      actorId,
      action: "LICENCE_GOVERNMENT_SUBMITTED",
      resource: "licence_application",
      details: { applicationId: application.id, company, submissionRef },
    },
    req,
    organisationId: org,
  });

  // Caseworker notifications
  const cwIds = Array.isArray(application.assignedcaseworkerId)
    ? application.assignedcaseworkerId
    : [];
  for (const cwId of cwIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.MEDIUM,
      title: `Application Submitted to UKVI: #LIC-${application.id}`,
      message: `${company} — licence application successfully submitted to UKVI.${submissionRef ? ` Reference: ${submissionRef}.` : ""} Status updated to Decision Pending.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "government_application_submitted",
      actionUrl: "/caseworker/licence-reviews",
      req,
      organisationId: org,
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

// ─── Intake: Information Form & Document Checklist ───────────────────────────

/** Sponsor submitted the 12-field information form — notify caseworkers. */
export async function intakeFormSubmitted({ tenantDb, application, caseworkerIds = [], req = null }) {
  if (!application) return;
  const company = application.companyName || `#LIC-${application.id}`;
  const org = orgFrom(req);

  for (const cwId of caseworkerIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title: `Intake Form Submitted: ${company}`,
      message: `${company} has completed and submitted their Sponsor Information Form. Please review the document checklist and verify uploaded documents.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "intake_form_submitted",
      actionUrl: `/caseworker/licence-reviews`,
      req,
      organisationId: org,
    });
  }
}

/** Sponsor uploaded a document — notify caseworkers. */
export async function intakeDocumentUploaded({ tenantDb, application, documentName, caseworkerIds = [], req = null }) {
  if (!application) return;
  const company = application.companyName || `#LIC-${application.id}`;
  const org = orgFrom(req);

  for (const cwId of caseworkerIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.LOW,
      title: `Document Uploaded: ${company}`,
      message: `${company} uploaded "${documentName}" to their intake document checklist. Please verify when ready.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "intake_document_uploaded",
      actionUrl: `/caseworker/licence-reviews`,
      req,
      organisationId: org,
    });
  }
}

/** Caseworker verified a document — notify sponsor. */
export async function intakeDocumentVerified({ tenantDb, application, documentName, req = null }) {
  if (!application) return;
  const org = orgFrom(req);

  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.SUCCESS,
    priority: NotificationPriority.MEDIUM,
    title: "Document Verified",
    message: `Your document "${documentName}" has been reviewed and verified. Please ensure all remaining documents are uploaded.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "intake_document_verified",
    actionUrl: "/business/licence-process",
    req,
    organisationId: org,
  });
}

/** Caseworker rejected a document — notify sponsor with reason. */
export async function intakeDocumentRejected({ tenantDb, application, documentName, reason, req = null }) {
  if (!application) return;
  const org = orgFrom(req);

  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    title: "Document Rejected — Action Required",
    message: `Your document "${documentName}" has been rejected. Reason: ${reason}. Please upload a corrected document as soon as possible.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "intake_document_rejected",
    actionUrl: "/business/licence-process",
    req,
    organisationId: org,
  });
}

/** Caseworker requested more information on a document — notify sponsor. */
export async function intakeDocumentInfoRequired({ tenantDb, application, documentName, notes, req = null }) {
  if (!application) return;
  const org = orgFrom(req);

  await deliver({
    tenantDb,
    recipientUserId: application.userId,
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    title: "Document Information Required",
    message: `More information is needed for your document "${documentName}". Note from caseworker: ${notes}. Please review and re-upload with the requested information.`,
    entityType: "licence_application",
    entityId: application.id,
    actionType: "intake_document_info_required",
    actionUrl: "/business/licence-process",
    req,
    organisationId: org,
  });
}

/** All mandatory intake documents verified — ready for Government Registration. */
export async function intakeReadyForGovernmentRegistration({ tenantDb, application, caseworkerIds = [], req = null }) {
  if (!application) return;
  const company = application.companyName || `#LIC-${application.id}`;
  const org = orgFrom(req);

  for (const cwId of caseworkerIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.HIGH,
      title: `Ready for Government Registration: ${company}`,
      message: `All mandatory intake documents for ${company} have been verified and the information form is complete. Government Registration can now be started.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "intake_ready_for_government_registration",
      actionUrl: `/caseworker/licence-reviews`,
      audit: {
        action: "INTAKE_COMPLETED",
        resource: "licence_application",
        details: { applicationId: application.id, company },
      },
      req,
      organisationId: org,
    });
  }
}

// ─── Event 5b: Licence Activated — caseworker notification ───────────────────

/**
 * Notify each assigned caseworker (in-app) when a sponsor licence is activated.
 * The sponsor's portal + email notification is handled by
 * licenceActivation.service.notifySponsorLicenceActivated.
 */
export async function licenceActivatedCaseworkers({
  tenantDb,
  application,
  licenceNumber,
  cosAllocation = 0,
  caseworkerIds = [],
  req = null,
}) {
  if (!application || !caseworkerIds.length) return;
  const company = application.companyName || `#LIC-${application.id}`;
  const org = orgFrom(req);

  for (const cwId of caseworkerIds) {
    const id = typeof cwId === "object" ? cwId.id ?? cwId.userId : cwId;
    if (!id) continue;
    await deliver({
      tenantDb,
      recipientUserId: id,
      type: NotificationTypes.SUCCESS,
      priority: NotificationPriority.HIGH,
      category: "licence",
      title: `Licence Activated: ${company}`,
      message: `Sponsor licence for ${company} is now Active. Licence No. ${licenceNumber}. CoS allocation: ${cosAllocation}.`,
      entityType: "licence_application",
      entityId: application.id,
      actionType: "licence_activated",
      actionUrl: `/caseworker/licence-reviews`,
      email: false,
      req,
      organisationId: org,
    });
  }
}
