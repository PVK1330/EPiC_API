import {
  wrapEpicEmail,
  credentialsBlockHtml,
  otpBlockHtml,
  infoBlockHtml,
  alertBlockHtml,
} from "./epicEmailLayout.js";

// Every generator accepts an optional trailing `branding` object
// ({ orgName, logoUrl, supportEmail, portalUrl, ... } — see emailBranding.js) so
// the shared shell renders the sending organisation's logo + name. When branding
// is omitted the shell falls back to a neutral platform identity, so existing
// callers keep working unchanged.
const brandName = (branding) => branding?.orgName || "EPiC";

// Utility for formatting object data into a neat HTML block
function metadataBlockHtml(metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return "";
  const rows = Object.entries(metadata)
    .map(
      ([key, val]) => `
    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
      <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;">${String(
        key,
      )
        .replace(/([A-Z])/g, " $1")
        .trim()}</span>
      <span style="font-size: 13px; font-weight: 600; color: #0f172a; text-align: right;">${Array.isArray(val) ? val.join(", ") : val}</span>
    </div>
  `,
    )
    .join("");
  return `<div style="background:#EEF1F5; border:1px solid #DDE3EA; border-radius:8px; padding:8px 16px; margin-bottom:30px;">${rows}</div>`;
}

export function generateOTPTemplate(otp, branding = {}) {
  const name = brandName(branding);
  return wrapEpicEmail({
    branding,
    pageTitle: `${name} — Email Verification`,
    badge: "Verification",
    title: "Your one-time code",
    messageHtml:
      "Enter this code to complete registration. It expires in <strong>10 minutes</strong>.",
    bodyHtml: otpBlockHtml(otp),
    securityHtml: `<strong>Never share this code.</strong> ${name} staff will never ask for your verification code.`,
  });
}

export function generatePasswordResetOTPTemplate(otp, branding = {}) {
  const name = brandName(branding);
  return wrapEpicEmail({
    branding,
    pageTitle: `${name} — Password Reset`,
    badge: "Password Reset",
    title: "Reset your password",
    messageHtml:
      "Use this code on the password reset page. It expires in <strong>10 minutes</strong>.",
    bodyHtml: otpBlockHtml(otp),
    securityHtml:
      "<strong>Never share this code.</strong> If you did not request a reset, ignore this email.",
  });
}

export function generateCredentialsTemplate(
  email,
  password,
  loginUrl,
  mainLoginUrl,
  branding = {},
) {
  const name = brandName(branding);
  return wrapEpicEmail({
    branding,
    pageTitle: `${name} — Your Account`,
    badge: "Account Ready",
    title: "Welcome to EPiC",
    messageHtml:
      "Your account is active. Use the credentials below to sign in and continue your immigration case.",
    bodyHtml: credentialsBlockHtml({ email, password, loginUrl, mainLoginUrl }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in to your dashboard",
    securityHtml:
      "<strong>Change your password</strong> after your first sign-in if you received a temporary password.",
  });
}

export function generateAdminCredentialsTemplate(
  email,
  password,
  loginUrl,
  mainLoginUrl,
  branding = {},
) {
  const name = brandName(branding);
  return wrapEpicEmail({
    branding,
    pageTitle: `${name} — Admin Account`,
    badge: "Administrator",
    title: "Admin account created",
    messageHtml:
      "Your administrator account has been set up. Use the credentials below to access your dashboard.",
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      mainLoginUrl,
      loginUrlLabel: "Admin Portal",
    }),
    ctaUrl: loginUrl,
    ctaLabel: "Access admin dashboard",
    securityHtml:
      "<strong>Important:</strong> Update your password immediately after your first sign-in.",
  });
}

export function generateOrganisationWelcomeTemplate({
  branding = {},
  organisationName,
  adminName,
  email,
  password,
  loginUrl,
  mainLoginUrl,
}) {
  const alt =
    mainLoginUrl && mainLoginUrl !== loginUrl
      ? `<p style="margin-top: 16px; font-size: 13px; color: #64748b;">Main portal: <a href="${mainLoginUrl}" style="color: #2563eb; font-weight: 500;">${mainLoginUrl}</a></p>`
      : "";

  return wrapEpicEmail({
    branding,
    pageTitle: `${organisationName} — Workspace Ready`,
    badge: organisationName,
    title: `Welcome, ${adminName}`,
    messageHtml: `Your organisation workspace on EPiC is ready. Sign in to set up <strong>${organisationName}</strong> and invite your team.${alt}`,
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      loginUrlLabel: "Workspace Login",
    }),
    ctaUrl: loginUrl,
    ctaLabel: `Sign in to ${organisationName}`,
    securityHtml:
      "<strong>Change your password</strong> immediately after your first sign-in.",
  });
}

export function generateCaseworkerWelcomeTemplate({
  branding = {},
  name,
  email,
  password,
  loginUrl,
  mainLoginUrl,
}) {
  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Caseworker Account`,
    badge: "Team Access",
    title: `Welcome, ${name}`,
    messageHtml:
      "Your caseworker account is ready. Log in to start managing cases and collaborating with your team.",
    bodyHtml: credentialsBlockHtml({ email, password, loginUrl, mainLoginUrl }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in to your dashboard",
  });
}

export function generateSponsorWelcomeTemplate({
  branding = {},
  name,
  email,
  password,
  loginUrl,
  mainLoginUrl,
}) {
  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Sponsor Account`,
    badge: "Sponsor Access",
    title: `Welcome, ${name}`,
    messageHtml:
      "Your sponsor account has been created. Log in to manage your licences, compliance, and sponsored workers.",
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      mainLoginUrl,
      loginUrlLabel: "Sponsor Portal",
    }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in to sponsor portal",
  });
}

export function generateCandidateWelcomeTemplate({
  branding = {},
  candidateName,
  email,
  password,
  loginUrl,
  mainLoginUrl,
}) {
  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Candidate Account`,
    badge: "Client Enquiry",
    title: `Welcome, ${candidateName}`,
    messageHtml:
      "Your EPiC account is ready. Sign in to submit your visa enquiry, upload documents, and track your case.",
    bodyHtml: credentialsBlockHtml({ email, password, loginUrl, mainLoginUrl }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in & start visa enquiry",
  });
}

export function generateNotificationEmailTemplate({
  branding = {},
  recipientName = "User",
  title,
  message,
  priority = "medium",
  notificationType = "info",
  actionUrl = null,
  metadata = {},
}) {
  const isAlert =
    priority.toLowerCase() === "high" ||
    notificationType.toLowerCase() === "error";
  const blockHtml = isAlert ? alertBlockHtml(message) : infoBlockHtml(message);

  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — ${title || "Notification"}`,
    badge: String(notificationType).toUpperCase(),
    title: title || "New Notification",
    messageHtml: `Hi ${recipientName},`,
    bodyHtml: `
      ${blockHtml}
      ${metadataBlockHtml(metadata)}
    `,
    ctaUrl: actionUrl,
    ctaLabel: actionUrl ? "Open in portal" : "",
  });
}

export function generateAppointmentTemplate({
  branding = {},
  title,
  date,
  time,
  platform,
  meetingUrl,
  candidateName,
  staffName,
  isStaffRecipient = false,
}) {
  const greeting = isStaffRecipient
    ? `Hi ${staffName},`
    : `Hi ${candidateName},`;
  const message = isStaffRecipient
    ? `A new meeting has been scheduled with candidate <strong>${candidateName}</strong>.`
    : `Your meeting with <strong>${staffName}</strong> has been successfully scheduled.`;

  const platformLabel =
    {
      teams: "Microsoft Teams",
      meet: "Google Meet",
      zoom: "Zoom",
      "in-person": "In-person Meeting",
    }[platform] || platform;

  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Appointment`,
    badge: "Meeting Scheduled",
    title: title,
    messageHtml: `${greeting}<br/><br/>${message}`,
    bodyHtml: metadataBlockHtml({
      Date: date,
      Time: time,
      Platform: platformLabel,
    }),
    ctaUrl: meetingUrl,
    ctaLabel: meetingUrl ? "Join Meeting" : "",
  });
}

export function generateSubscriptionExpiryTemplate({
  branding = {},
  organisationName,
  daysRemaining,
  loginUrl,
  type = "trial",
}) {
  const title =
    daysRemaining <= 0 ? "Subscription Expired" : "Subscription Expiring Soon";
  const message =
    daysRemaining <= 0
      ? `Your ${type} subscription for <strong>${organisationName}</strong> has expired. Access to premium features is currently restricted.`
      : `Your ${type} subscription for <strong>${organisationName}</strong> will expire in <strong>${daysRemaining} day(s)</strong>.`;

  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Subscription`,
    badge: "Billing Notice",
    title: title,
    messageHtml: message,
    bodyHtml: alertBlockHtml(
      "Please update your billing information or choose a new plan to ensure uninterrupted access to the platform.",
    ),
    ctaUrl: loginUrl,
    ctaLabel: "Manage Subscription",
  });
}

export function generateDiagnosticTemplate({ source, message, branding = {} }) {
  const name = brandName(branding);
  return wrapEpicEmail({
    branding,
    pageTitle: `${name} — System Diagnostic`,
    badge: "SMTP Test",
    title: "SMTP Connection Verified",
    messageHtml:
      "This is a diagnostic test email dispatched from your EPiC platform.",
    bodyHtml: metadataBlockHtml({ Status: "Success", TransportSource: source }),
    securityHtml:
      "This email was triggered manually by an administrator via the connectivity settings.",
  });
}

export function generateFailureNoticeTemplate({
  branding = {},
  reasonLabel,
  recipientSafe,
  subjectSafe,
  ctxSafe,
  errSafe,
}) {
  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Delivery Failure`,
    badge: "Delivery Failed",
    title: "Message undeliverable",
    messageHtml: `${brandName(branding)} could not deliver a message to the intended recipient.`,
    bodyHtml: `
      ${alertBlockHtml(`<strong>Error:</strong> ${errSafe}`)}
      ${metadataBlockHtml({ Reason: reasonLabel, Recipient: recipientSafe, Subject: subjectSafe, Context: ctxSafe || "None" })}
    `,
    securityHtml:
      "You are receiving this automated failure receipt because you are the designated SMTP account owner.",
  });
}

export function generateUKVIPortalCredentialsTemplate({
  recipientName,
  companyName,
  ukviPortalUserId,
  ukviPortalPassword,
  licenceId,
  actionUrl,
}) {
  const credBlock = credentialsBlockHtml({
    email: ukviPortalUserId,
    password: ukviPortalPassword,
    loginUrlLabel: "UKVI Portal",
    loginUrl: null,
    mainLoginUrl: null,
  });
  return wrapEpicEmail({
    pageTitle: "EPiC — UKVI Portal Credentials",
    badge: "Government Portal",
    title: "Your UKVI Portal Credentials",
    messageHtml: `Hi ${recipientName},<br/><br/>Your UKVI Sponsorship Management System (SMS) portal login credentials for <strong>${companyName}</strong> are ready. Use these to access the UKVI online portal and complete your sponsor licence application.`,
    bodyHtml: credBlock,
    ctaUrl: actionUrl || null,
    ctaLabel: actionUrl ? "Go to Licence Portal" : "",
    securityHtml:
      "<strong>Keep these credentials confidential.</strong> Do not share your UKVI portal username or password with anyone. Once you have logged in, please change your password immediately. If you did not expect this email, contact your caseworker immediately.",
  });
}

export function generateDocumentDispatchTemplate({
  recipientName,
  companyName,
  senderName,
  senderRole,
  documentName,
  documentType,
  message,
  portalUrl,
}) {
  const typeLabel =
    {
      declaration_form: "Declaration Form",
      credentials: "Credentials Document",
      sponsor_licence: "Sponsor Licence",
      supporting_document: "Supporting Document",
      other: "Document",
    }[documentType] || "Document";

  return wrapEpicEmail({
    pageTitle: `EPiC — ${typeLabel} from your caseworker`,
    badge: "Document Received",
    title: `A document has been sent to you`,
    messageHtml: `Hi ${recipientName},<br/><br/>Your caseworker <strong>${senderName}</strong> has sent you a <strong>${typeLabel}</strong> for <strong>${companyName}</strong>.<br/><br/>Document: <strong>${documentName}</strong>${message ? `<br/><br/>Message from ${senderName}: <em>${message}</em>` : ""}`,
    bodyHtml: infoBlockHtml(
      `The document is attached to this email. You can also view and download all documents sent to you from your EPiC sponsor portal.`,
    ),
    ctaUrl: portalUrl || null,
    ctaLabel: portalUrl ? "Open Sponsor Portal" : "",
    securityHtml:
      "This document was sent by your assigned EPiC caseworker or administrator. If you were not expecting this, please contact your caseworker directly.",
  });
}

export function generateDispatchReceiptTemplate({
  branding = {},
  recipient,
  subject,
  ctx,
  messageId,
  response,
}) {
  return wrapEpicEmail({
    branding,
    pageTitle: `${brandName(branding)} — Dispatch Receipt`,
    badge: "Dispatched",
    title: "Email accepted by SMTP",
    messageHtml: "Your SMTP server accepted this message for delivery.",
    bodyHtml: metadataBlockHtml({
      Recipient: recipient,
      Subject: subject,
      Context: ctx || "None",
      MessageID: messageId || "N/A",
      SMTPResponse: response || "N/A",
    }),
    securityHtml:
      "If the recipient did not receive the email, check their spam folder. You received this copy because you are the configured SMTP account owner.",
  });
}
