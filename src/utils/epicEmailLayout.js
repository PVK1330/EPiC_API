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
    ? `<div style="display: inline-block; background-color: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; margin-bottom: 16px;">${badge}</div>`
    : "";

  const ctaBlock =
    ctaUrl && ctaLabel
      ? `<div style="margin-top: 32px; margin-bottom: 32px; text-align: center;">
           <a href="${ctaUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 8px;">${ctaLabel}</a>
         </div>`
      : "";

  const securityBlock = securityHtml
    ? `<div style="background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 12px 16px; font-size: 13px; color: #64748b; line-height: 1.5; border-radius: 0 8px 8px 0; margin-top: 32px;">${securityHtml}</div>`
    : `<div style="background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 12px 16px; font-size: 13px; color: #64748b; line-height: 1.5; border-radius: 0 8px 8px 0; margin-top: 32px;"><strong>Security Notice:</strong> Keep this message private. If you did not expect it, please contact your administrator.</div>`;

  // Fallback to text if image fails on local testing
  const logoUrl = process.env.BASE_URL ? `${process.env.BASE_URL}/assets/elitepic_logo.png` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f7f6; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 30px 40px 20px 40px; background-color: #ffffff; border-bottom: 2px solid #f1f5f9;">
              <h2 style="margin:0; font-size: 28px; color: #1e3a8a; font-weight: 900; letter-spacing: -0.5px;">EPiC<span style="color:#2563eb;">.</span></h2>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              ${badgeBlock}
              ${title ? `<h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; letter-spacing: -0.5px;">${title}</h1>` : ""}
              ${messageHtml ? `<div style="font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 24px;">${messageHtml}</div>` : ""}
              
              <div style="font-size: 14px; color: #334155; line-height: 1.6;">
                ${bodyHtml}
              </div>

              ${ctaBlock}
              ${securityBlock}
            </td>
          </tr>
          
        </table>

        <!-- Footer -->
        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin-top: 20px;">
          <tr>
            <td align="center" style="padding: 0 20px;">
              <p style="font-size: 12px; color: #94a3b8; line-height: 1.6; margin: 0 0 4px 0;">&copy; ${new Date().getFullYear()} EPiC System. All rights reserved.</p>
              <p style="font-size: 12px; color: #94a3b8; line-height: 1.6; margin: 0;">This is an automated system notification. Please do not reply.</p>
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
    ? `<div style="padding: 16px; border-bottom: 1px solid #f1f5f9;">
         <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">${loginUrlLabel}</div>
         <div style="font-size: 14px; font-weight: 600;"><a href="${loginUrl}" style="color: #2563eb; text-decoration: none;">${loginUrl}</a></div>
       </div>`
    : "";
  const mainUrlRow = mainLoginUrl && mainLoginUrl !== loginUrl
    ? `<div style="padding: 16px;">
         <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">${mainLoginUrlLabel}</div>
         <div style="font-size: 14px; font-weight: 600;"><a href="${mainLoginUrl}" style="color: #2563eb; text-decoration: none;">${mainLoginUrl}</a></div>
       </div>`
    : "";
  return `<div style="border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 32px; background-color: #ffffff;">
    <div style="background: #f8fafc; padding: 12px 16px; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Access Credentials</div>
    <div style="padding: 16px; border-bottom: 1px solid #f1f5f9;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Email Address</div>
      <div style="font-size: 14px; color: #0f172a; font-weight: 600;">${email}</div>
    </div>
    ${password ? `<div style="padding: 16px; border-bottom: 1px solid #f1f5f9;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Password</div>
      <div style="font-size: 14px; color: #0f172a; font-weight: 600; font-family: monospace;">${password}</div>
    </div>` : ""}
    ${urlRow}
    ${mainUrlRow}
  </div>`;
}

export function otpBlockHtml(otp) {
  return `<div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 24px; text-align: center; margin-bottom: 32px;">
    <div style="font-size: 12px; color: #64748b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Verification Code</div>
    <div style="font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: 8px; font-family: monospace;">${otp}</div>
  </div>`;
}

export function infoBlockHtml(html) {
  return `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 32px; font-size: 14px; color: #166534; line-height: 1.5;">${html}</div>`;
}

export function alertBlockHtml(html) {
  return `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 32px; font-size: 14px; color: #991b1b; line-height: 1.5;">${html}</div>`;
}
