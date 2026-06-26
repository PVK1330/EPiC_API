/**
 * THE single EPiC email shell — one professional, UK-styled frame used by every
 * email the platform sends. Per-tenant LOGO + ORGANISATION NAME + inner CONTENT
 * vary; the visual frame (layout, colours, typography) is identical for every
 * tenant. Pass a `branding` object (see utils/emailBranding.js); when omitted it
 * falls back to a neutral platform identity.
 *
 * Palette: deep navy + GOV.UK blue + GOV.UK red (red·white·blue) — a restrained,
 * institutional, UK-government-grade look suited to immigration/legal work.
 * Keep these hexes in sync with EMAIL_PALETTE in utils/emailBranding.js.
 */
const C = {
  navy: "#0B2E5E",
  navyDark: "#071F40",
  blue: "#1D70B8",
  blueTint: "#EAF0F7",
  ink: "#0B0C0C",
  body: "#33414F",
  muted: "#6B7785",
  border: "#DDE3EA",
  surface: "#FFFFFF",
  pageBg: "#EEF1F5",
  success: "#00703C",
  successBg: "#E7F2EC",
  successBorder: "#B7DCC6",
  danger: "#D4351C",
  dangerBg: "#FBE9E6",
  dangerBorder: "#F3B6AC",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Header brand mark: tenant logo image, or the org-name wordmark when no logo. */
function brandMark(branding) {
  const orgName = esc(branding?.orgName || "EPiC");
  const logoUrl = branding?.logoUrl ? esc(branding.logoUrl) : "";

  if (logoUrl) {
    return `<img src="${logoUrl}" alt="${orgName}" height="44" style="display:block; max-height:44px; width:auto; border:0; outline:none; text-decoration:none;" />`;
  }
  return `<span style="font-size:24px; font-weight:800; letter-spacing:-0.4px; color:${C.navy};">${orgName}</span>`;
}

/**
 * Render an email in the shared shell.
 * @param {object} opts
 * @param {object} [opts.branding] - { orgName, logoUrl, supportEmail, portalUrl, isPlatform }
 */
export function wrapEpicEmail({
  pageTitle = "",
  badge = "",
  badgeColor = null,
  title = "",
  messageHtml = "",
  bodyHtml = "",
  ctaUrl = "",
  ctaLabel = "",
  securityHtml = "",
  branding = null,
} = {}) {
  const orgName = esc(branding?.orgName || "EPiC");
  const supportEmail = branding?.supportEmail ? esc(branding.supportEmail) : "";
  const year = new Date().getFullYear();
  const resolvedPageTitle = esc(pageTitle || branding?.orgName || "EPiC");

  // When badgeColor is supplied (e.g. from notification emails) use it; otherwise
  // fall back to the default blue-tint style for welcome/credential/OTP emails.
  const badgeBg   = badgeColor ? `${badgeColor}18` : C.blueTint; // 18 = ~10% alpha hex
  const badgeFg   = badgeColor || C.navy;
  const badgeBlock = badge
    ? `<div style="display:inline-block; background-color:${badgeBg}; color:${badgeFg}; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:5px 11px; border-radius:6px; margin-bottom:18px; border:1px solid ${badgeFg}22;">${badge}</div>`
    : "";

  const ctaBlock =
    ctaUrl && ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0;">
           <tr>
             <td align="center" style="border-radius:8px; background-color:${C.navy};">
               <a href="${esc(ctaUrl)}" target="_blank" style="display:inline-block; padding:13px 26px; font-family:${FONT}; font-size:14px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:8px;">${ctaLabel}&nbsp;&rarr;</a>
             </td>
           </tr>
         </table>`
      : "";

  const securityBlock = `<div style="background:${C.pageBg}; border-left:3px solid ${C.navy}; padding:12px 16px; font-size:13px; color:${C.muted}; line-height:1.55; border-radius:0 8px 8px 0; margin-top:30px;">${
    securityHtml ||
    "<strong>Security notice:</strong> Keep this message private. If you did not expect it, please contact your administrator."
  }</div>`;

  const supportLine = supportEmail
    ? `<p style="font-size:12px; color:${C.muted}; line-height:1.6; margin:0 0 4px 0;">Need help? Contact <a href="mailto:${supportEmail}" style="color:${C.blue}; text-decoration:none;">${supportEmail}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${resolvedPageTitle}</title>
</head>
<body style="margin:0; padding:0; font-family:${FONT}; background-color:${C.pageBg}; color:${C.body}; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${esc(title || messageHtml || resolvedPageTitle)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.pageBg}; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:${C.surface}; border-radius:14px; box-shadow:0 6px 24px rgba(11,46,94,0.08); overflow:hidden;">

          <!-- Top accent bar — navy for standard emails, notification-type colour when set -->
          <tr><td style="height:4px; line-height:4px; font-size:0; background-color:${badgeColor || C.navy};">&nbsp;</td></tr>

          <!-- Header / brand mark -->
          <tr>
            <td align="center" style="padding:28px 40px 22px 40px; background-color:${C.surface}; border-bottom:1px solid ${C.border};">
              ${brandMark(branding)}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:38px 40px;">
              ${badgeBlock}
              ${title ? `<h1 style="font-size:22px; font-weight:800; color:${C.ink}; margin:0 0 16px 0; letter-spacing:-0.4px; line-height:1.3;">${title}</h1>` : ""}
              ${messageHtml ? `<div style="font-size:15px; color:${C.body}; line-height:1.65; margin-bottom:22px;">${messageHtml}</div>` : ""}

              <div style="font-size:14px; color:${C.body}; line-height:1.65;">
                ${bodyHtml}
              </div>

              ${ctaBlock}
              ${securityBlock}
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; margin-top:22px;">
          <tr>
            <td align="center" style="padding:0 20px;">
              ${supportLine}
              <p style="font-size:12px; color:${C.muted}; line-height:1.6; margin:0 0 4px 0;">&copy; ${year} ${orgName}. All rights reserved.</p>
              <p style="font-size:12px; color:${C.muted}; line-height:1.6; margin:0;">This is an automated message — please do not reply directly to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function credentialsBlockHtml({ email, password, loginUrl, mainLoginUrl, loginUrlLabel = "Portal Login", mainLoginUrlLabel = "Main Portal" }) {
  const urlRow = loginUrl
    ? `<div style="padding:16px; border-bottom:1px solid ${C.border};">
         <div style="font-size:12px; color:${C.muted}; margin-bottom:4px;">${loginUrlLabel}</div>
         <div style="font-size:14px; font-weight:600;"><a href="${loginUrl}" style="color:${C.blue}; text-decoration:none;">${loginUrl}</a></div>
       </div>`
    : "";
  const mainUrlRow = mainLoginUrl && mainLoginUrl !== loginUrl
    ? `<div style="padding:16px;">
         <div style="font-size:12px; color:${C.muted}; margin-bottom:4px;">${mainLoginUrlLabel}</div>
         <div style="font-size:14px; font-weight:600;"><a href="${mainLoginUrl}" style="color:${C.blue}; text-decoration:none;">${mainLoginUrl}</a></div>
       </div>`
    : "";
  return `<div style="border:1px solid ${C.border}; border-radius:10px; overflow:hidden; margin-bottom:30px; background-color:${C.surface};">
    <div style="background:${C.pageBg}; padding:12px 16px; font-size:11px; font-weight:700; color:${C.muted}; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid ${C.border};">Access Credentials</div>
    <div style="padding:16px; border-bottom:1px solid ${C.border};">
      <div style="font-size:12px; color:${C.muted}; margin-bottom:4px;">Email Address</div>
      <div style="font-size:14px; color:${C.ink}; font-weight:600;">${email}</div>
    </div>
    ${password ? `<div style="padding:16px; border-bottom:1px solid ${C.border};">
      <div style="font-size:12px; color:${C.muted}; margin-bottom:4px;">Password</div>
      <div style="font-size:14px; color:${C.ink}; font-weight:600; font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${password}</div>
    </div>` : ""}
    ${urlRow}
    ${mainUrlRow}
  </div>`;
}

export function otpBlockHtml(otp) {
  return `<div style="background:${C.blueTint}; border:1px dashed ${C.blue}; border-radius:10px; padding:24px; text-align:center; margin-bottom:30px;">
    <div style="font-size:12px; color:${C.muted}; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Verification Code</div>
    <div style="font-size:34px; font-weight:800; color:${C.navy}; letter-spacing:10px; font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${otp}</div>
  </div>`;
}

export function infoBlockHtml(html) {
  return `<div style="background:${C.successBg}; border:1px solid ${C.successBorder}; border-radius:8px; padding:16px; margin-bottom:30px; font-size:14px; color:${C.success}; line-height:1.55;">${html}</div>`;
}

export function alertBlockHtml(html) {
  return `<div style="background:${C.dangerBg}; border:1px solid ${C.dangerBorder}; border-radius:8px; padding:16px; margin-bottom:30px; font-size:14px; color:${C.danger}; line-height:1.55;">${html}</div>`;
}
