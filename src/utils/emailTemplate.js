export const generateOTPTemplate = (otp) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elite Pic - OTP Verification</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #eef2f7;
                padding: 30px 16px;
            }
            .wrapper {
                max-width: 580px;
                margin: 0 auto;
            }
            /* ── HEADER / LOGO BAND ── */
            .header {
                background-color: #004ca5;
                border-radius: 12px 12px 0 0;
                padding: 28px 32px;
                display: flex;
                align-items: center;
                gap: 14px;
            }
            .logo-mark {
                width: 48px; height: 48px;
                background-color: #ffffff;
                border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
            }
            .logo-mark svg { width: 32px; height: 32px; }
            .brand-name {
                font-size: 22px;
                font-weight: 700;
                color: #ffffff;
                letter-spacing: -0.4px;
            }
            .brand-name span { color: #f5a623; }
            .brand-sub {
                font-size: 10px;
                color: rgba(255,255,255,0.65);
                letter-spacing: 2px;
                text-transform: uppercase;
                margin-top: 2px;
            }
            /* ── GOLD ACCENT STRIPE ── */
            .accent-stripe {
                height: 4px;
                background: linear-gradient(90deg, #c8102e 0%, #f5a623 50%, #004ca5 100%);
            }
            /* ── BODY CARD ── */
            .card {
                background: #ffffff;
                padding: 40px 36px;
                border-left: 1px solid #dde4ef;
                border-right: 1px solid #dde4ef;
            }
            .icon-circle {
                width: 60px; height: 60px;
                border-radius: 50%;
                background-color: #eef2f7;
                border: 2px solid #004ca5;
                display: flex; align-items: center; justify-content: center;
                margin: 0 auto 20px;
            }
            .icon-circle svg { width: 28px; height: 28px; }
            .title {
                font-size: 22px;
                font-weight: 700;
                color: #004ca5;
                text-align: center;
                margin-bottom: 12px;
            }
            .message {
                font-size: 15px;
                color: #556070;
                text-align: center;
                line-height: 1.7;
                margin-bottom: 32px;
            }
            /* ── OTP BOX ── */
            .otp-box {
                border: 2px solid #004ca5;
                border-radius: 12px;
                padding: 24px 20px;
                text-align: center;
                margin: 0 auto 28px;
                background: #f5f8ff;
                max-width: 320px;
            }
            .otp-label {
                font-size: 11px;
                font-weight: 700;
                color: #004ca5;
                letter-spacing: 2px;
                text-transform: uppercase;
                margin-bottom: 12px;
            }
            .otp-code {
                font-size: 40px;
                font-weight: 700;
                color: #c8102e;
                letter-spacing: 10px;
                font-family: 'Courier New', monospace;
            }
            .otp-divider {
                width: 40px; height: 2px;
                background-color: #f5a623;
                margin: 14px auto 0;
                border-radius: 2px;
            }
            .expiry {
                font-size: 13px;
                color: #778090;
                text-align: center;
                margin-bottom: 24px;
            }
            .expiry strong { color: #c8102e; }
            .note-box {
                background: #fff8f0;
                border-left: 3px solid #f5a623;
                border-radius: 0 6px 6px 0;
                padding: 12px 16px;
                font-size: 13px;
                color: #7a5c20;
                line-height: 1.6;
            }
            /* ── FOOTER ── */
            .footer {
                background-color: #004ca5;
                border-radius: 0 0 12px 12px;
                padding: 20px 32px;
                text-align: center;
            }
            .footer p {
                font-size: 12px;
                color: rgba(255,255,255,0.6);
                line-height: 1.6;
            }
            .footer .highlight { color: #f5a623; font-weight: 600; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <!-- Header -->
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
                    <div class="brand-name">elite<span>pic</span></div>
                    <div class="brand-sub">Customer Relationship Management</div>
                </div>
            </div>

            <!-- Accent stripe -->
            <div class="accent-stripe"></div>

            <!-- Body -->
            <div class="card">
                <div class="icon-circle">
                    <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="6" width="22" height="16" rx="3" stroke="#004ca5" stroke-width="2"/>
                        <path d="M3 9l11 8 11-8" stroke="#004ca5" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>

                <h1 class="title">Verify Your Email Address</h1>
                <p class="message">
                    Thank you for choosing Elite Pic! To complete your registration,
                    please use the One-Time Password below to verify your email address.
                </p>

                <div class="otp-box">
                    <div class="otp-label">Your OTP Code</div>
                    <div class="otp-code">${otp}</div>
                    <div class="otp-divider"></div>
                </div>

                <p class="expiry">This OTP will expire in <strong>10 minutes</strong> for security reasons.</p>

                <div class="note-box">
                    If you didn't request this verification, please ignore this email or contact our support team immediately.
                </div>
            </div>

            <!-- Footer -->
            <div class="footer">
                <p>© 2024 <span class="highlight">Elite Pic</span>. All rights reserved.</p>
                <p>This is an automated message. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
  `;
};


export const generateCredentialsTemplate = (email, password, loginUrl) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elite Pic - Account Credentials</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #eef2f7;
                padding: 30px 16px;
            }
            .wrapper { max-width: 580px; margin: 0 auto; }
            .header {
                background-color: #004ca5;
                border-radius: 12px 12px 0 0;
                padding: 28px 32px;
                display: flex; align-items: center; gap: 14px;
            }
            .logo-mark {
                width: 48px; height: 48px;
                background-color: #ffffff;
                border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
            }
            .logo-mark svg { width: 32px; height: 32px; }
            .brand-name { font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.4px; }
            .brand-name span { color: #f5a623; }
            .brand-sub { font-size: 10px; color: rgba(255,255,255,0.65); letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
            .accent-stripe { height: 4px; background: linear-gradient(90deg, #c8102e 0%, #f5a623 50%, #004ca5 100%); }
            .card { background: #ffffff; padding: 40px 36px; border-left: 1px solid #dde4ef; border-right: 1px solid #dde4ef; }
            .welcome-badge {
                display: inline-block;
                background-color: #eef2f7;
                color: #004ca5;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 2px;
                text-transform: uppercase;
                padding: 5px 14px;
                border-radius: 20px;
                border: 1px solid #c2d0e8;
                margin-bottom: 16px;
            }
            .title { font-size: 22px; font-weight: 700; color: #004ca5; margin-bottom: 10px; }
            .message { font-size: 15px; color: #556070; line-height: 1.7; margin-bottom: 28px; }
            /* credentials box */
            .cred-box {
                border: 1.5px solid #dde4ef;
                border-radius: 12px;
                overflow: hidden;
                margin-bottom: 28px;
            }
            .cred-box-header {
                background: #004ca5;
                padding: 12px 20px;
                font-size: 11px;
                font-weight: 700;
                color: rgba(255,255,255,0.85);
                letter-spacing: 2px;
                text-transform: uppercase;
            }
            .cred-item {
                padding: 16px 20px;
                border-bottom: 1px solid #eef2f7;
                display: flex; align-items: flex-start; gap: 14px;
            }
            .cred-item:last-child { border-bottom: none; }
            .cred-dot {
                width: 8px; height: 8px; border-radius: 50%;
                background-color: #c8102e;
                margin-top: 6px; flex-shrink: 0;
            }
            .cred-label { font-size: 11px; font-weight: 700; color: #8a9ab0; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
            .cred-value { font-size: 15px; color: #1a2a3a; font-family: 'Courier New', monospace; word-break: break-all; }
            /* CTA button */
            .btn-wrap { text-align: center; margin-bottom: 28px; }
            .login-btn {
                display: inline-block;
                background-color: #c8102e;
                color: #ffffff;
                text-decoration: none;
                font-size: 15px;
                font-weight: 600;
                padding: 14px 36px;
                border-radius: 8px;
                letter-spacing: 0.3px;
            }
            /* security note */
            .security-box {
                background: #fff8f0;
                border-left: 3px solid #f5a623;
                border-radius: 0 6px 6px 0;
                padding: 14px 16px;
                font-size: 13px;
                color: #7a5c20;
                line-height: 1.6;
            }
            .footer { background-color: #004ca5; border-radius: 0 0 12px 12px; padding: 20px 32px; text-align: center; }
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
                    <div class="brand-name">elite<span>pic</span></div>
                    <div class="brand-sub">Customer Relationship Management</div>
                </div>
            </div>
            <div class="accent-stripe"></div>

            <div class="card">
                <div class="welcome-badge">Account Ready</div>
                <h1 class="title">Welcome to Elite Pic!</h1>
                <p class="message">
                    Your email has been successfully verified. Below are your login credentials
                    and a direct link to access your dashboard.
                </p>

                <div class="cred-box">
                    <div class="cred-box-header">Your Login Credentials</div>
                    <div class="cred-item">
                        <div class="cred-dot"></div>
                        <div>
                            <div class="cred-label">Email Address</div>
                            <div class="cred-value">${email}</div>
                        </div>
                    </div>
                    <div class="cred-item">
                        <div class="cred-dot"></div>
                        <div>
                            <div class="cred-label">Password</div>
                            <div class="cred-value">${password}</div>
                        </div>
                    </div>
                </div>

                <div class="btn-wrap">
                    <a href="${loginUrl}" class="login-btn">Access Your Dashboard</a>
                </div>

                <div class="security-box">
                    <strong>Security Notice:</strong> Please keep your credentials safe and do not
                    share them with anyone. If you didn't request this email, contact our support team immediately.
                </div>
            </div>

            <div class="footer">
                <p>© 2024 <span class="highlight">Elite Pic</span>. All rights reserved.</p>
                <p>This is an automated message. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
  `;
};


export const generateAdminCredentialsTemplate = (email, password, loginUrl) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elite Pic - Admin Account Created</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #eef2f7;
                padding: 30px 16px;
            }
            .wrapper { max-width: 580px; margin: 0 auto; }
            /* header — deeper shade for admin */
            .header {
                background-color: #002f6c;
                border-radius: 12px 12px 0 0;
                padding: 28px 32px;
                display: flex; align-items: center; justify-content: space-between;
            }
            .header-left { display: flex; align-items: center; gap: 14px; }
            .logo-mark {
                width: 48px; height: 48px;
                background-color: #ffffff;
                border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
            }
            .logo-mark svg { width: 32px; height: 32px; }
            .brand-name { font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.4px; }
            .brand-name span { color: #f5a623; }
            .brand-sub { font-size: 10px; color: rgba(255,255,255,0.65); letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
            .admin-badge {
                background-color: #c8102e;
                color: #ffffff;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                padding: 6px 14px;
                border-radius: 20px;
            }
            /* tri-color stripe — thicker for admin */
            .accent-stripe { height: 5px; background: linear-gradient(90deg, #c8102e 0%, #f5a623 50%, #002f6c 100%); }
            .card { background: #ffffff; padding: 40px 36px; border-left: 1px solid #dde4ef; border-right: 1px solid #dde4ef; }
            /* shield icon row */
            .admin-hero {
                display: flex; align-items: center; gap: 16px;
                background: #f5f8ff;
                border: 1.5px solid #c2d0e8;
                border-radius: 10px;
                padding: 18px 20px;
                margin-bottom: 28px;
            }
            .shield-icon {
                width: 44px; height: 44px; flex-shrink: 0;
                background: #004ca5;
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
            }
            .shield-icon svg { width: 22px; height: 22px; }
            .admin-hero-text h2 { font-size: 16px; font-weight: 700; color: #004ca5; margin-bottom: 4px; }
            .admin-hero-text p { font-size: 13px; color: #556070; line-height: 1.5; }
            .title { font-size: 22px; font-weight: 700; color: #002f6c; margin-bottom: 10px; }
            .message { font-size: 15px; color: #556070; line-height: 1.7; margin-bottom: 28px; }
            /* credentials */
            .cred-box { border: 1.5px solid #dde4ef; border-radius: 12px; overflow: hidden; margin-bottom: 28px; }
            .cred-box-header {
                background: #002f6c;
                padding: 12px 20px;
                font-size: 11px; font-weight: 700;
                color: rgba(255,255,255,0.85);
                letter-spacing: 2px; text-transform: uppercase;
            }
            .cred-item { padding: 16px 20px; border-bottom: 1px solid #eef2f7; display: flex; align-items: flex-start; gap: 14px; }
            .cred-item:last-child { border-bottom: none; }
            .cred-dot { width: 8px; height: 8px; border-radius: 50%; background-color: #c8102e; margin-top: 6px; flex-shrink: 0; }
            .cred-label { font-size: 11px; font-weight: 700; color: #8a9ab0; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
            .cred-value { font-size: 15px; color: #1a2a3a; font-family: 'Courier New', monospace; word-break: break-all; font-weight: 700; }
            /* CTA */
            .btn-wrap { text-align: center; margin-bottom: 28px; }
            .login-btn {
                display: inline-block;
                background-color: #004ca5;
                color: #ffffff;
                text-decoration: none;
                font-size: 15px; font-weight: 600;
                padding: 14px 36px;
                border-radius: 8px;
                letter-spacing: 0.3px;
            }
            /* warning */
            .warning-box {
                background: #fff8f0;
                border-left: 3px solid #f5a623;
                border-radius: 0 6px 6px 0;
                padding: 14px 16px;
                font-size: 13px; color: #7a5c20; line-height: 1.6;
                margin-bottom: 16px;
            }
            .danger-box {
                background: #fff5f5;
                border-left: 3px solid #c8102e;
                border-radius: 0 6px 6px 0;
                padding: 14px 16px;
                font-size: 13px; color: #7a1a1a; line-height: 1.6;
            }
            .footer { background-color: #002f6c; border-radius: 0 0 12px 12px; padding: 20px 32px; text-align: center; }
            .footer p { font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.8; }
            .footer .highlight { color: #f5a623; font-weight: 600; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="header">
                <div class="header-left">
                    <div class="logo-mark">
                        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <ellipse cx="13" cy="16" rx="7" ry="7" fill="none" stroke="#004ca5" stroke-width="2.2"/>
                            <circle cx="10.5" cy="16" r="2.2" fill="#c8102e"/>
                            <path d="M18 16 Q22 10 27 14 Q32 18 27 22 Q22 26 18 20" fill="#f5a623" opacity="0.85"/>
                            <circle cx="25" cy="16" r="2" fill="#004ca5"/>
                        </svg>
                    </div>
                    <div>
                        <div class="brand-name">elite<span>pic</span></div>
                        <div class="brand-sub">Customer Relationship Management</div>
                    </div>
                </div>
                <div class="admin-badge">Admin</div>
            </div>
            <div class="accent-stripe"></div>

            <div class="card">
                <div class="admin-hero">
                    <div class="shield-icon">
                        <svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11 2L3 5.5v6c0 4.5 3.4 8.7 8 9.5 4.6-.8 8-5 8-9.5v-6L11 2z" fill="#ffffff" opacity="0.2" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
                            <path d="M7.5 11l2.5 2.5 5-5" stroke="#f5a623" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <div class="admin-hero-text">
                        <h2>Admin Account Created</h2>
                        <p>This account has elevated privileges to manage users, reports, and system settings.</p>
                    </div>
                </div>

                <h1 class="title">Welcome to the Admin Panel</h1>
                <p class="message">
                    Your admin account has been successfully set up. Below are your login credentials
                    for accessing the Elite Pic administration panel.
                </p>

                <div class="cred-box">
                    <div class="cred-box-header">Admin Login Credentials</div>
                    <div class="cred-item">
                        <div class="cred-dot"></div>
                        <div>
                            <div class="cred-label">Admin Email</div>
                            <div class="cred-value">${email}</div>
                        </div>
                    </div>
                    <div class="cred-item">
                        <div class="cred-dot"></div>
                        <div>
                            <div class="cred-label">Admin Password</div>
                            <div class="cred-value">${password}</div>
                        </div>
                    </div>
                </div>

                <div class="btn-wrap">
                    <a href="${loginUrl}" class="login-btn">Access Admin Dashboard</a>
                </div>

                <div class="warning-box">
                    <strong>Admin Privileges Notice:</strong> Keep these credentials strictly confidential.
                    Do not share them with unauthorized personnel. This account can manage all platform data.
                </div>
                <br/>
                <div class="danger-box">
                    <strong>Security Tip:</strong> We strongly recommend changing your password immediately after your first login.
                    If you did not request this account, contact your system administrator at once.
                </div>
            </div>

            <div class="footer">
                <p>© 2024 <span class="highlight">Elite Pic</span>. All rights reserved.</p>
                <p>This is an automated message. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
  `;
};

/** Caseworker account — same credential layout as generic template, distinct copy for role. */
export const generateCaseworkerCredentialsTemplate = (email, password, loginUrl, firstName = "") => {
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elite Pic - Caseworker Account</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #eef2f7; padding: 30px 16px; }
            .wrapper { max-width: 580px; margin: 0 auto; }
            .header {
                background-color: #0d5c3b;
                border-radius: 12px 12px 0 0;
                padding: 28px 32px;
                display: flex; align-items: center; justify-content: space-between;
            }
            .header-left { display: flex; align-items: center; gap: 14px; }
            .logo-mark {
                width: 48px; height: 48px;
                background-color: #ffffff;
                border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
            }
            .logo-mark svg { width: 32px; height: 32px; }
            .brand-name { font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.4px; }
            .brand-name span { color: #f5a623; }
            .brand-sub { font-size: 10px; color: rgba(255,255,255,0.65); letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
            .role-badge {
                background-color: #f5a623;
                color: #1a2a3a;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                padding: 6px 14px;
                border-radius: 20px;
            }
            .accent-stripe { height: 4px; background: linear-gradient(90deg, #c8102e 0%, #f5a623 50%, #0d5c3b 100%); }
            .card { background: #ffffff; padding: 40px 36px; border-left: 1px solid #dde4ef; border-right: 1px solid #dde4ef; }
            .title { font-size: 22px; font-weight: 700; color: #0d5c3b; margin-bottom: 10px; }
            .message { font-size: 15px; color: #556070; line-height: 1.7; margin-bottom: 28px; }
            .cred-box { border: 1.5px solid #dde4ef; border-radius: 12px; overflow: hidden; margin-bottom: 28px; }
            .cred-box-header {
                background: #0d5c3b;
                padding: 12px 20px;
                font-size: 11px; font-weight: 700;
                color: rgba(255,255,255,0.9);
                letter-spacing: 2px; text-transform: uppercase;
            }
            .cred-item { padding: 16px 20px; border-bottom: 1px solid #eef2f7; display: flex; align-items: flex-start; gap: 14px; }
            .cred-item:last-child { border-bottom: none; }
            .cred-dot { width: 8px; height: 8px; border-radius: 50%; background-color: #c8102e; margin-top: 6px; flex-shrink: 0; }
            .cred-label { font-size: 11px; font-weight: 700; color: #8a9ab0; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
            .cred-value { font-size: 15px; color: #1a2a3a; font-family: 'Courier New', monospace; word-break: break-all; }
            .btn-wrap { text-align: center; margin-bottom: 28px; }
            .login-btn {
                display: inline-block;
                background-color: #0d5c3b;
                color: #ffffff;
                text-decoration: none;
                font-size: 15px; font-weight: 600;
                padding: 14px 36px;
                border-radius: 8px;
            }
            .security-box {
                background: #fff8f0;
                border-left: 3px solid #f5a623;
                border-radius: 0 6px 6px 0;
                padding: 14px 16px;
                font-size: 13px; color: #7a5c20; line-height: 1.6;
            }
            .footer { background-color: #0d5c3b; border-radius: 0 0 12px 12px; padding: 20px 32px; text-align: center; }
            .footer p { font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.8; }
            .footer .highlight { color: #f5a623; font-weight: 600; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="header">
                <div class="header-left">
                    <div class="logo-mark">
                        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <ellipse cx="13" cy="16" rx="7" ry="7" fill="none" stroke="#0d5c3b" stroke-width="2.2"/>
                            <circle cx="10.5" cy="16" r="2.2" fill="#c8102e"/>
                            <path d="M18 16 Q22 10 27 14 Q32 18 27 22 Q22 26 18 20" fill="#f5a623" opacity="0.85"/>
                            <circle cx="25" cy="16" r="2" fill="#0d5c3b"/>
                        </svg>
                    </div>
                    <div>
                        <div class="brand-name">elite<span>pic</span></div>
                        <div class="brand-sub">Customer Relationship Management</div>
                    </div>
                </div>
                <div class="role-badge">Caseworker</div>
            </div>
            <div class="accent-stripe"></div>
            <div class="card">
                <h1 class="title">Your caseworker account is ready</h1>
                <p class="message">
                    ${greeting}<br/><br/>
                    An administrator has created your Elite Pic caseworker account. Use the credentials below to sign in.
                    Please change your password after your first login.
                </p>
                <div class="cred-box">
                    <div class="cred-box-header">Login credentials</div>
                    <div class="cred-item">
                        <div class="cred-dot"></div>
                        <div>
                            <div class="cred-label">Email</div>
                            <div class="cred-value">${email}</div>
                        </div>
                    </div>
                    <div class="cred-item">
                        <div class="cred-dot"></div>
                        <div>
                            <div class="cred-label">Password</div>
                            <div class="cred-value">${password}</div>
                        </div>
                    </div>
                </div>
                <div class="btn-wrap">
                    <a href="${loginUrl}" class="login-btn">Open Elite Pic</a>
                </div>
                <div class="security-box">
                    <strong>Security:</strong> Do not share these credentials. If you did not expect this email, contact your administrator.
                </div>
            </div>
            <div class="footer">
                <p>© 2024 <span class="highlight">Elite Pic</span>. All rights reserved.</p>
                <p>This is an automated message. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
  `;
};
