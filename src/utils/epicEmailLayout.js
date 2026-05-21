/**
 * Shared EPiC email shell — header, stripe, card, footer.
 * Modern, premium, minimalist aesthetic.
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
}) {
  const badgeBlock = badge
    ? `<div class="welcome-badge">${badge}</div>`
    : "";

  const ctaBlock =
    ctaUrl && ctaLabel
      ? `<div class="btn-wrap"><a href="${ctaUrl}" class="primary-btn">${ctaLabel}</a></div>`
      : "";

  const securityBlock = securityHtml
    ? `<div class="security-box">${securityHtml}</div>`
    : `<div class="security-box"><strong>Security Notice:</strong> Keep this message private. If you did not expect it, please contact your administrator.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    /* Reset & Base */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      background-color: #f8fafc; 
      color: #334155;
      padding: 40px 16px; 
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .wrapper { max-width: 520px; margin: 0 auto; }
    
    /* Header / Logo */
    .header { text-align: center; margin-bottom: 24px; }
    .logo-container {
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 16px;
    }
    .logo-container img { width: 140px; height: auto; display: block; }
    
    /* Main Card */
    .card { 
      background: #ffffff; 
      padding: 40px; 
      border-radius: 16px; 
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
      border: 1px solid #e2e8f0;
      margin-bottom: 24px;
    }
    
    /* Typography */
    .welcome-badge { 
      display: inline-block; background-color: #f1f5f9; color: #475569; 
      font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; 
      padding: 4px 10px; border-radius: 6px; margin-bottom: 16px; 
    }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px; letter-spacing: -0.5px; }
    .message { font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 32px; }
    .message strong { color: #0f172a; font-weight: 600; }
    
    /* Credentials Block */
    .cred-box { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 32px; }
    .cred-box-header { background: #f8fafc; padding: 12px 16px; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; }
    .cred-item { padding: 16px; border-bottom: 1px solid #f1f5f9; }
    .cred-item:last-child { border-bottom: none; }
    .cred-label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .cred-value { font-size: 14px; color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all; font-weight: 600; }
    
    /* OTP Block */
    .otp-box { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 24px; text-align: center; margin-bottom: 32px; }
    .otp-label { font-size: 12px; color: #64748b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .otp-code { font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    
    /* Info & Alert Blocks */
    .info-block { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 32px; font-size: 14px; color: #166534; line-height: 1.5; }
    .alert-block { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 32px; font-size: 14px; color: #991b1b; line-height: 1.5; }
    
    /* Buttons */
    .btn-wrap { margin-bottom: 32px; }
    .primary-btn { 
      display: inline-block; background-color: #2563eb; color: #ffffff !important; 
      text-decoration: none; font-size: 14px; font-weight: 600; 
      padding: 12px 24px; border-radius: 8px; transition: background-color 0.2s;
    }
    
    /* Security Box */
    .security-box { background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 12px 16px; font-size: 13px; color: #64748b; line-height: 1.5; border-radius: 0 8px 8px 0; }
    
    /* Footer */
    .footer { text-align: center; padding: 0 20px; }
    .footer p { font-size: 12px; color: #94a3b8; line-height: 1.6; margin-bottom: 4px; }
    .footer a { color: #94a3b8; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo-container">
        <img src="${process.env.BASE_URL || 'http://localhost:5000'}/assets/elitepic_logo.png" alt="EPiC Logo" />
      </div>
    </div>
    
    <div class="card">
      ${badgeBlock}
      ${title ? `<h1 class="title">${title}</h1>` : ""}
      ${messageHtml ? `<div class="message">${messageHtml}</div>` : ""}
      ${bodyHtml}
      ${ctaBlock}
      ${securityBlock}
    </div>
    
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} EPiC. All rights reserved.</p>
      <p>This is an automated system notification.</p>
    </div>
  </div>
</body>
</html>`;
}

export function credentialsBlockHtml({ email, password, loginUrl, mainLoginUrl, loginUrlLabel = "Portal Login", mainLoginUrlLabel = "Main Portal" }) {
  const urlRow = loginUrl
    ? `<div class="cred-item">
         <div class="cred-label">${loginUrlLabel}</div>
         <div class="cred-value" style="font-family: inherit;"><a href="${loginUrl}" style="color: #2563eb; text-decoration: none;">${loginUrl}</a></div>
       </div>`
    : "";
  const mainUrlRow = mainLoginUrl && mainLoginUrl !== loginUrl
    ? `<div class="cred-item">
         <div class="cred-label">${mainLoginUrlLabel}</div>
         <div class="cred-value" style="font-family: inherit;"><a href="${mainLoginUrl}" style="color: #2563eb; text-decoration: none;">${mainLoginUrl}</a></div>
       </div>`
    : "";
  return `<div class="cred-box">
    <div class="cred-box-header">Access Credentials</div>
    <div class="cred-item">
      <div class="cred-label">Email Address</div>
      <div class="cred-value">${email}</div>
    </div>
    ${password ? `<div class="cred-item">
      <div class="cred-label">Password</div>
      <div class="cred-value">${password}</div>
    </div>` : ""}
    ${urlRow}
    ${mainUrlRow}
  </div>`;
}

export function otpBlockHtml(otp) {
  return `<div class="otp-box">
    <div class="otp-label">Verification Code</div>
    <div class="otp-code">${otp}</div>
  </div>`;
}

export function infoBlockHtml(html) {
  return `<div class="info-block">${html}</div>`;
}

export function alertBlockHtml(html) {
  return `<div class="alert-block">${html}</div>`;
}
