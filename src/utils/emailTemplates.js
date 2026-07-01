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

// Maps internal notification type/priority to a human-readable badge and colour.
function resolveBadge(notificationType, priority) {
  const t = String(notificationType).toLowerCase();
  const p = String(priority).toLowerCase();
  if (t === "error" || p === "critical") return { label: "Urgent Notice",      color: "#D4351C" };
  if (t === "success")                   return { label: "Completed",           color: "#00703C" };
  if (t === "warning" || p === "high")   return { label: "Action Required",     color: "#B04A00" };
  return                                        { label: "Application Update",  color: "#1D70B8" };
}

// Converts plain text paragraphs separated by newlines into HTML <p> tags so
// the email body is readable prose rather than one collapsed line.
function messageToParagraphsHtml(message) {
  if (!message) return "";
  return String(message)
    .split(/\n{1,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="margin:0 0 14px 0; font-size:15px; color:#33414F; line-height:1.7;">${para}</p>`,
    )
    .join("");
}

export function generateNotificationEmailTemplate({
  branding = {},
  recipientName = "there",
  title,
  message,
  priority = "medium",
  notificationType = "info",
  actionUrl = null,
}) {
  const org = brandName(branding);
  const { label: badgeLabel, color: badgeColor } = resolveBadge(notificationType, priority);
  const isUrgent =
    String(notificationType).toLowerCase() === "error" ||
    String(priority).toLowerCase() === "critical";

  // Urgent emails get a prominent coloured notice strip; others get prose only.
  const urgentStrip = isUrgent
    ? `<div style="background:#FBE9E6; border:1px solid #F3B6AC; border-radius:8px; padding:14px 18px; margin-bottom:22px; font-size:14px; color:#D4351C; line-height:1.55; font-weight:600;">
        ⚠ This notification requires your immediate attention. Please log in to your portal to take action.
       </div>`
    : "";

  const paragraphsHtml = messageToParagraphsHtml(message);

  const ctaLabel = (() => {
    const t = String(notificationType).toLowerCase();
    const p = String(priority).toLowerCase();
    if (!actionUrl) return "";
    if (t === "error" || p === "high" || p === "critical") return "Take action now →";
    if (t === "success") return "View in portal →";
    return "View in your portal →";
  })();

  return wrapEpicEmail({
    branding,
    pageTitle: `${org} — ${title || "Notification"}`,
    badge: badgeLabel,
    badgeColor,
    title: title || "Portal Notification",
    messageHtml: `Hi ${recipientName},`,
    bodyHtml: `
      ${urgentStrip}
      <div style="margin-bottom:24px;">
        ${paragraphsHtml}
      </div>
      ${
        actionUrl
          ? `<div style="background:#EAF0F7; border:1px solid #C4D4E8; border-radius:8px; padding:14px 18px; margin-bottom:8px; font-size:13px; color:#1D70B8; line-height:1.55;">
              Log in to your ${org} portal to view the full details and take any required action.
             </div>`
          : ""
      }
    `,
    ctaUrl: actionUrl,
    ctaLabel,
    securityHtml: `This is an automated message from <strong>${org}</strong>. If you were not expecting this notification or believe it was sent in error, please contact your caseworker or administrator.`,
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

/**
 * Dedicated email template for Sponsor Licence Granted / Renewed events.
 * Renders a styled "licence details" block (licence number, issued, expiry, CoS)
 * with a green accent — visually distinct from the generic notification template.
 */
export function generateLicenceGrantedTemplate({
  branding = {},
  recipientName = "there",
  companyName,
  licenceNumber,
  issuedDate,
  expiryDate,
  cosAllocation = null,
  isRenewal = false,
  actionUrl = null,
}) {
  const org = brandName(branding);
  const issuedStr  = issuedDate  ? new Date(issuedDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  const expiryStr  = expiryDate  ? new Date(expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

  const C = {
    ink: "#0B0C0C", muted: "#6B7785", border: "#DDE3EA", pageBg: "#EEF1F5",
    success: "#00703C", successBg: "#E7F2EC", successBorder: "#B7DCC6",
  };

  // Licence details block — mirrors the credentialsBlockHtml style
  const rows = [
    { label: "Licence Number", value: `<span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:16px;font-weight:800;color:${C.success};letter-spacing:1px;">${licenceNumber}</span>` },
    { label: "Company",        value: companyName },
    ...(issuedStr  ? [{ label: "Date Issued",    value: issuedStr  }] : []),
    ...(expiryStr  ? [{ label: "Expiry Date",     value: expiryStr  }] : []),
    ...(cosAllocation != null ? [{ label: "CoS Allocation", value: String(cosAllocation) }] : []),
  ];
  const detailsBlock = `<div style="border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-bottom:24px;">
    <div style="background:${C.pageBg};padding:12px 16px;font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${C.border};">Licence Details</div>
    ${rows.map((r, i) => `<div style="padding:14px 16px;${i < rows.length - 1 ? `border-bottom:1px solid ${C.border};` : ""}">
      <div style="font-size:11px;color:${C.muted};margin-bottom:4px;font-weight:600;">${r.label}</div>
      <div style="font-size:14px;color:${C.ink};font-weight:700;">${r.value}</div>
    </div>`).join("")}
  </div>`;

  const successBox = `<div style="background:${C.successBg};border:1px solid ${C.successBorder};border-radius:8px;padding:14px 16px;font-size:14px;color:${C.success};line-height:1.55;margin-bottom:8px;font-weight:600;">
    You can now request Certificates of Sponsorship (CoS) and add sponsored workers through your ${org} portal.
  </div>`;

  return wrapEpicEmail({
    branding,
    pageTitle: `${org} — ${isRenewal ? "Sponsor Licence Renewed" : "Sponsor Licence Granted"}`,
    badge: isRenewal ? "Licence Renewed" : "Licence Granted",
    badgeColor: "#00703C",
    title: isRenewal ? "Your Sponsor Licence Has Been Renewed" : "Your Sponsor Licence Has Been Granted",
    messageHtml: `Hi ${recipientName},<br/><br/>Congratulations — your ${isRenewal ? "sponsor licence has been renewed" : "sponsor licence application for <strong>" + companyName + "</strong> has been approved"} by UKVI.`,
    bodyHtml: detailsBlock + successBox,
    ctaUrl: actionUrl,
    ctaLabel: actionUrl ? (isRenewal ? "View renewed licence →" : "View in your portal →") : "",
    securityHtml: `This is an automated message from <strong>${org}</strong>. If you were not expecting this notification, please contact your caseworker or administrator.`,
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

/**
 * Monthly Compliance Review email — Section N
 *
 * Sent to Sponsor, Caseworkers, and Admins on the 1st of each month.
 * Five sections mirror the five-section JSON payload stored in the DB.
 */
export function generateMonthlyComplianceReportTemplate({
  branding = {},
  recipientName = "Team",
  orgName = "Organisation",
  reportMonth = "This Month",
  complianceSummary = {},
  workersExpiring = [],
  reportingHistory = {},
  missingDocuments = [],
  riskMovement = {},
}) {
  const name = brandName(branding) || orgName;

  // ── Section 1: Compliance Summary ──────────────────────────────────────────
  const summaryHtml = `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px; font-weight:700; color:#0B2E5E; margin:0 0 12px 0; border-bottom:2px solid #1D70B8; padding-bottom:8px;">
        1. Compliance Summary
      </h2>
      ${metadataBlockHtml({
        "Total Workers": complianceSummary.totalWorkers ?? 0,
        "High Risk": complianceSummary.highRiskCount ?? 0,
        "Medium Risk": complianceSummary.mediumRiskCount ?? 0,
        "Low Risk": complianceSummary.lowRiskCount ?? 0,
        "Compliance Score": complianceSummary.complianceScore != null ? `${complianceSummary.complianceScore}%` : "N/A",
        "Risk Level": complianceSummary.riskLevel || "N/A",
        "Licence Status": complianceSummary.licenceStatus || "N/A",
      })}
    </div>`;

  // ── Section 2: Workers Expiring in 90 Days ─────────────────────────────────
  const expiryRows = workersExpiring.length
    ? workersExpiring
        .map(
          (w) =>
            `<tr>
              <td style="padding:8px 12px; font-size:13px; color:#0B0C0C; border-bottom:1px solid #EEF1F5;">${w.candidateName || "—"}</td>
              <td style="padding:8px 12px; font-size:13px; color:#0B0C0C; border-bottom:1px solid #EEF1F5;">${w.visaType || "—"}</td>
              <td style="padding:8px 12px; font-size:13px; color:#0B0C0C; border-bottom:1px solid #EEF1F5;">${w.visaEndDate || "—"}</td>
              <td style="padding:8px 12px; font-size:13px; font-weight:700; color:${w.urgency === "high" ? "#D4351C" : "#B04A00"}; border-bottom:1px solid #EEF1F5;">${w.daysRemaining != null ? `${w.daysRemaining}d` : "—"}</td>
             </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" style="padding:12px; font-size:13px; color:#6B7785; text-align:center;">No workers expiring within 90 days.</td></tr>`;

  const expiryHtml = `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px; font-weight:700; color:#0B2E5E; margin:0 0 12px 0; border-bottom:2px solid #1D70B8; padding-bottom:8px;">
        2. Workers Expiring in 90 Days (${workersExpiring.length})
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:1px solid #DDE3EA; border-radius:8px; overflow:hidden;">
        <thead>
          <tr style="background:#EAF0F7;">
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Worker</th>
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Visa Type</th>
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Expiry Date</th>
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Days Left</th>
          </tr>
        </thead>
        <tbody>${expiryRows}</tbody>
      </table>
    </div>`;

  // ── Section 3: Reporting History ───────────────────────────────────────────
  const historyHtml = `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px; font-weight:700; color:#0B2E5E; margin:0 0 12px 0; border-bottom:2px solid #1D70B8; padding-bottom:8px;">
        3. Reporting History (${reportMonth})
      </h2>
      ${metadataBlockHtml({
        "Total Actions": reportingHistory.total ?? 0,
        "Submitted / Re-submitted": reportingHistory.submitted ?? 0,
        "Under Review": reportingHistory.underReview ?? 0,
        "Approved": reportingHistory.approved ?? 0,
        "Rejected": reportingHistory.rejected ?? 0,
        "Information Requested": reportingHistory.informationRequested ?? 0,
      })}
    </div>`;

  // ── Section 4: Missing Documents ───────────────────────────────────────────
  const missingRows = missingDocuments.length
    ? missingDocuments
        .map(
          (d) =>
            `<tr>
              <td style="padding:8px 12px; font-size:13px; color:#0B0C0C; border-bottom:1px solid #EEF1F5;">${d.documentType || "—"}</td>
              <td style="padding:8px 12px; font-size:13px; font-weight:700; color:#D4351C; border-bottom:1px solid #EEF1F5; text-transform:capitalize;">${d.status || "—"}</td>
              <td style="padding:8px 12px; font-size:13px; color:#6B7785; border-bottom:1px solid #EEF1F5;">${d.expiryDate || "—"}</td>
             </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="padding:12px; font-size:13px; color:#00703C; text-align:center; font-weight:600;">No missing or expired documents.</td></tr>`;

  const missingHtml = `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px; font-weight:700; color:#0B2E5E; margin:0 0 12px 0; border-bottom:2px solid #1D70B8; padding-bottom:8px;">
        4. Missing / Expired Documents (${missingDocuments.length})
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:1px solid #DDE3EA; border-radius:8px; overflow:hidden;">
        <thead>
          <tr style="background:#EAF0F7;">
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Document Type</th>
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Status</th>
            <th style="padding:10px 12px; font-size:12px; font-weight:700; color:#0B2E5E; text-align:left;">Expiry Date</th>
          </tr>
        </thead>
        <tbody>${missingRows}</tbody>
      </table>
    </div>`;

  // ── Section 5: Risk Movement ────────────────────────────────────────────────
  const riskArrow =
    riskMovement.direction === "improved"
      ? "▼ Improved"
      : riskMovement.direction === "worse"
      ? "▲ Worsened"
      : "→ Unchanged";
  const riskColor =
    riskMovement.direction === "improved"
      ? "#00703C"
      : riskMovement.direction === "worse"
      ? "#D4351C"
      : "#6B7785";

  const riskHtml = `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:16px; font-weight:700; color:#0B2E5E; margin:0 0 12px 0; border-bottom:2px solid #1D70B8; padding-bottom:8px;">
        5. Risk Movement
      </h2>
      ${metadataBlockHtml({
        "Current Risk Score": riskMovement.currentRiskScore != null ? `${riskMovement.currentRiskScore}` : "N/A",
        "Previous Risk Score": riskMovement.previousRiskScore != null ? `${riskMovement.previousRiskScore}` : "No prior report",
        "Change": riskMovement.delta != null ? `${riskMovement.delta > 0 ? "+" : ""}${riskMovement.delta}` : "N/A",
        "Trend": riskMovement.direction ? `${riskArrow}` : "N/A",
        "Compared to Month": riskMovement.previousReportMonth || "N/A",
      })}
      ${riskMovement.direction && riskMovement.direction !== "unchanged"
        ? `<div style="background:${riskMovement.direction === "improved" ? "#E7F2EC" : "#FBE9E6"}; border:1px solid ${riskMovement.direction === "improved" ? "#B7DCC6" : "#F3B6AC"}; border-radius:8px; padding:12px 16px; margin-top:10px; font-size:13px; font-weight:700; color:${riskColor};">
            ${riskArrow} — Your compliance risk score has ${riskMovement.direction === "improved" ? "improved" : "deteriorated"} since last month.
           </div>`
        : ""}
    </div>`;

  return wrapEpicEmail({
    branding,
    pageTitle: `${name} — Monthly Compliance Review: ${reportMonth}`,
    badge: "Monthly Compliance Report",
    badgeColor: "#0B2E5E",
    title: `Compliance Review — ${reportMonth}`,
    messageHtml: `Hi ${recipientName}, here is your monthly compliance review for <strong>${orgName}</strong>.`,
    bodyHtml: summaryHtml + expiryHtml + historyHtml + missingHtml + riskHtml,
    ctaLabel: "View Full Report in Portal",
    securityHtml: `This automated monthly compliance report was generated on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} for <strong>${name}</strong>. Please log in to your portal to take any required action.`,
  });
}
