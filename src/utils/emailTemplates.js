import { wrapEpicEmail, credentialsBlockHtml, otpBlockHtml } from "./epicEmailLayout.js";

export function generateOTPTemplate(otp) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Email verification",
    badge: "Verification",
    title: "Your one-time code",
    messageHtml:
      "Enter this code to complete registration. It expires in <strong>10 minutes</strong>.",
    bodyHtml: otpBlockHtml(otp),
    securityHtml:
      "<strong>Never share this code.</strong> EPiC staff will never ask for your OTP.",
  });
}

export function generatePasswordResetOTPTemplate(otp) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Password reset",
    badge: "Password reset",
    title: "Reset your password",
    messageHtml:
      "Use this code on the password reset page. It expires in <strong>10 minutes</strong>.",
    bodyHtml: otpBlockHtml(otp),
    securityHtml:
      "<strong>Never share this code.</strong> If you did not request a reset, ignore this email.",
  });
}

export function generateCredentialsTemplate(email, password, loginUrl) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Your account",
    badge: "Account ready",
    title: "Welcome to EPiC",
    messageHtml:
      "Your account is active. Use the credentials below to sign in and continue your immigration case.",
    bodyHtml: credentialsBlockHtml({ email, password, loginUrl }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in to your dashboard",
    securityHtml:
      "<strong>Change your password</strong> after your first sign-in if you received a temporary password.",
  });
}

export function generateAdminCredentialsTemplate(email, password, loginUrl) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Admin account",
    badge: "Admin",
    title: "Admin account created",
    messageHtml:
      "Your organisation admin account is ready. You can manage users, cases, and settings from the admin panel.",
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      loginUrlLabel: "Organisation login URL",
    }),
    ctaUrl: loginUrl,
    ctaLabel: "Open admin dashboard",
    securityHtml:
      "<strong>Admin access:</strong> Keep these credentials confidential. Change your password after first login.",
    headerVariant: "admin",
  });
}

export function generateOrganisationWelcomeTemplate({
  organisationName,
  adminName,
  email,
  password,
  loginUrl,
  mainLoginUrl,
}) {
  const alt =
    mainLoginUrl && mainLoginUrl !== loginUrl
      ? `<p style="margin-top:-12px;font-size:14px;color:#556070;">Main portal: <a href="${mainLoginUrl}" style="color:#004ca5;font-weight:600;">${mainLoginUrl}</a></p>`
      : "";

  return wrapEpicEmail({
    pageTitle: `EPiC — ${organisationName}`,
    badge: organisationName,
    title: `Welcome, ${adminName}`,
    messageHtml: `Your organisation workspace on EPiC is ready. Sign in to set up ${organisationName} and invite your team.${alt}`,
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      loginUrlLabel: "Organisation login URL",
    }),
    ctaUrl: loginUrl,
    ctaLabel: `Sign in to ${organisationName}`,
    headerVariant: "admin",
  });
}

export function generateCaseworkerWelcomeTemplate({
  name,
  email,
  password,
  loginUrl,
}) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Caseworker account",
    badge: "Caseworker",
    title: `Welcome, ${name}`,
    messageHtml:
      "Your caseworker account is ready. Sign in to manage assigned cases, documents, and client communication for your organisation.",
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      loginUrlLabel: "Organisation login URL",
    }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in to caseworker portal",
    securityHtml:
      "<strong>Keep credentials confidential.</strong> Change your password after your first sign-in.",
  });
}

export function generateSponsorWelcomeTemplate({
  name,
  email,
  password,
  loginUrl,
}) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Sponsor account",
    badge: "Sponsor",
    title: `Welcome, ${name}`,
    messageHtml:
      "Your sponsor (business) account is ready. Sign in to manage your organisation profile, sponsored workers, and licence details.",
    bodyHtml: credentialsBlockHtml({
      email,
      password,
      loginUrl,
      loginUrlLabel: "Organisation login URL",
    }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in to sponsor portal",
    securityHtml:
      "<strong>Keep credentials confidential.</strong> Use your organisation login URL — not the main platform URL.",
  });
}

export function generateCandidateWelcomeTemplate({
  candidateName,
  email,
  password,
  loginUrl,
}) {
  return wrapEpicEmail({
    pageTitle: "EPiC — Candidate account",
    badge: "Client enquiry",
    title: `Welcome, ${candidateName}`,
    messageHtml:
      "Your EPiC account is ready. Sign in to submit your visa enquiry, upload documents, and track your case through our standard 16-step immigration process — starting with <strong>Client Enquiry</strong>.",
    bodyHtml: credentialsBlockHtml({ email, password, loginUrl }),
    ctaUrl: loginUrl,
    ctaLabel: "Sign in & start visa enquiry",
    securityHtml:
      "<strong>Next step:</strong> After signing in, complete your visa enquiry or application form so your caseworker can begin the consultation stage.",
  });
}
