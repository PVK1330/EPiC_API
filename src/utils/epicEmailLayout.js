/**
 * Shared EPiC email shell — header, stripe, card, footer.
 * Only inner body (badge, title, message, optional blocks) changes per email type.
 */
export function wrapEpicEmail({
  pageTitle = "EPiC",
  badge = "",
  title = "",
  messageHtml = "",
  bodyHtml = "",
  ctaUrl = "",
  ctaLabel = "",
  securityHtml = "",
  headerVariant = "default",
}) {
  const headerBg = headerVariant === "admin" ? "#002f6c" : "#004ca5";
  const footerBg = headerVariant === "admin" ? "#002f6c" : "#004ca5";
  const btnBg = headerVariant === "admin" ? "#004ca5" : "#c8102e";

  const badgeBlock = badge
    ? `<div class="welcome-badge">${badge}</div>`
    : "";

  const ctaBlock =
    ctaUrl && ctaLabel
      ? `<div class="btn-wrap"><a href="${ctaUrl}" class="login-btn">${ctaLabel}</a></div>`
      : "";

  const securityBlock = securityHtml
    ? `<div class="security-box">${securityHtml}</div>`
    : `<div class="security-box"><strong>Security:</strong> Keep this message private. If you did not expect it, contact your administrator.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #eef2f7; padding: 30px 16px; }
    .wrapper { max-width: 580px; margin: 0 auto; }
    .header { background-color: ${headerBg}; border-radius: 12px 12px 0 0; padding: 28px 32px; display: flex; align-items: center; gap: 14px; }
    .logo-mark { width: 48px; height: 48px; background-color: #ffffff; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
    .logo-mark svg { width: 32px; height: 32px; }
    .brand-name { font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.4px; }
    .brand-name span { color: #f5a623; }
    .brand-sub { font-size: 10px; color: rgba(255,255,255,0.65); letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
    .accent-stripe { height: 4px; background: linear-gradient(90deg, #c8102e 0%, #f5a623 50%, ${headerBg} 100%); }
    .card { background: #ffffff; padding: 40px 36px; border-left: 1px solid #dde4ef; border-right: 1px solid #dde4ef; }
    .welcome-badge { display: inline-block; background-color: #eef2f7; color: #004ca5; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; padding: 5px 14px; border-radius: 20px; border: 1px solid #c2d0e8; margin-bottom: 16px; }
    .title { font-size: 22px; font-weight: 700; color: ${headerBg}; margin-bottom: 10px; }
    .message { font-size: 15px; color: #556070; line-height: 1.7; margin-bottom: 28px; }
    .cred-box { border: 1.5px solid #dde4ef; border-radius: 12px; overflow: hidden; margin-bottom: 28px; }
    .cred-box-header { background: ${headerBg}; padding: 12px 20px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.85); letter-spacing: 2px; text-transform: uppercase; }
    .cred-item { padding: 16px 20px; border-bottom: 1px solid #eef2f7; display: flex; align-items: flex-start; gap: 14px; }
    .cred-item:last-child { border-bottom: none; }
    .cred-dot { width: 8px; height: 8px; border-radius: 50%; background-color: #c8102e; margin-top: 6px; flex-shrink: 0; }
    .cred-label { font-size: 11px; font-weight: 700; color: #8a9ab0; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
    .cred-value { font-size: 15px; color: #1a2a3a; font-family: 'Courier New', monospace; word-break: break-all; font-weight: 700; }
    .otp-box { border: 2px solid #004ca5; border-radius: 12px; padding: 24px 20px; text-align: center; margin: 0 auto 28px; background: #f5f8ff; max-width: 320px; }
    .otp-label { font-size: 11px; font-weight: 700; color: #004ca5; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; }
    .otp-code { font-size: 40px; font-weight: 700; color: #c8102e; letter-spacing: 10px; font-family: 'Courier New', monospace; }
    .btn-wrap { text-align: center; margin-bottom: 28px; }
    .login-btn { display: inline-block; background-color: ${btnBg}; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 8px; }
    .security-box { background: #fff8f0; border-left: 3px solid #f5a623; border-radius: 0 6px 6px 0; padding: 14px 16px; font-size: 13px; color: #7a5c20; line-height: 1.6; }
    .footer { background-color: ${footerBg}; border-radius: 0 0 12px 12px; padding: 20px 32px; text-align: center; }
    .footer p { font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.8; }
    .footer .highlight { color: #f5a623; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo-mark">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="13" cy="16" rx="7" ry="7" fill="none" stroke="#004ca5" stroke-width="2.2"/>
          <circle cx="10.5" cy="16" r="2.2" fill="#c8102e"/>
          <path d="M18 16 Q22 10 27 14 Q32 18 27 22 Q22 26 18 20" fill="#f5a623" opacity="0.85"/>
          <circle cx="25" cy="16" r="2" fill="#004ca5"/>
        </svg>
      </div>
      <div>
        <div class="brand-name">EP<span>i</span>C</div>
        <div class="brand-sub">Immigration Case Management</div>
      </div>
    </div>
    <div class="accent-stripe"></div>
    <div class="card">
      ${badgeBlock}
      ${title ? `<h1 class="title">${title}</h1>` : ""}
      ${messageHtml ? `<div class="message">${messageHtml}</div>` : ""}
      ${bodyHtml}
      ${ctaBlock}
      ${securityBlock}
    </div>
    <div class="footer">
      <p>© 2026 <span class="highlight">EPiC</span>. All rights reserved.</p>
      <p>This is an automated message. Please do not reply.</p>
    </div>
  </div>
</body>
</html>`;
}

export function credentialsBlockHtml({ email, password, loginUrl, loginUrlLabel = "Login URL" }) {
  const urlRow = loginUrl
    ? `<div class="cred-item">
        <div class="cred-dot"></div>
        <div>
          <div class="cred-label">${loginUrlLabel}</div>
          <div class="cred-value" style="font-family:inherit;font-weight:600;"><a href="${loginUrl}">${loginUrl}</a></div>
        </div>
      </div>`
    : "";
  return `<div class="cred-box">
    <div class="cred-box-header">Login credentials</div>
    <div class="cred-item">
      <div class="cred-dot"></div>
      <div><div class="cred-label">Email</div><div class="cred-value">${email}</div></div>
    </div>
    <div class="cred-item">
      <div class="cred-dot"></div>
      <div><div class="cred-label">Password</div><div class="cred-value">${password}</div></div>
    </div>
    ${urlRow}
  </div>`;
}

export function otpBlockHtml(otp) {
  return `<div class="otp-box">
    <div class="otp-label">Verification code</div>
    <div class="otp-code">${otp}</div>
  </div>`;
}
