// const generateOTPTemplate = (otp) => {
//   return `
//     <!DOCTYPE html>
//     <html lang="en">
//     <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>Elite Pic - OTP Verification</title>
//         <style>
//             * {
//                 margin: 0;
//                 padding: 0;
//                 box-sizing: border-box;
//             }
//             body {
//                 font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
//                 background-color: #f4f4f4;
//                 padding: 20px;
//             }
//             .container {
//                 max-width: 600px;
//                 margin: 0 auto;
//                 background-color: #ffffff;
//                 border-radius: 10px;
//                 overflow: hidden;
//                 box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
//             }
//             .header {
//                 background: linear-gradient(135deg, #004ca5 0%, #003d82 100%);
//                 padding: 30px;
//                 text-align: center;
//             }
//             .logo {
//                 text-align: center;
//                 margin-bottom: 20px;
//             }
//             .logo img {
//                 max-width: 200px;
//                 height: auto;
//                 border-radius: 8px;
//             }
//             .content {
//                 padding: 40px 30px;
//                 text-align: center;
//             }
//             .title {
//                 font-size: 24px;
//                 color: #333;
//                 margin-bottom: 20px;
//                 font-weight: 600;
//             }
//             .message {
//                 font-size: 16px;
//                 color: #666;
//                 margin-bottom: 30px;
//                 line-height: 1.6;
//             }
//             .otp-container {
//                 background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
//                 border: 2px solid #004ca5;
//                 border-radius: 10px;
//                 padding: 20px;
//                 margin: 30px 0;
//                 display: inline-block;
//             }
//             .otp-label {
//                 font-size: 14px;
//                 color: #004ca5;
//                 font-weight: 600;
//                 margin-bottom: 10px;
//                 text-transform: uppercase;
//                 letter-spacing: 1px;
//             }
//             .otp-code {
//                 font-size: 36px;
//                 font-weight: bold;
//                 color: #c8102e;
//                 letter-spacing: 8px;
//                 font-family: 'Courier New', monospace;
//             }
//             .expiry {
//                 font-size: 14px;
//                 color: #666;
//                 margin-top: 20px;
//                 font-style: italic;
//             }
//             .footer {
//                 background-color: #f8f9fa;
//                 padding: 20px;
//                 text-align: center;
//                 border-top: 1px solid #e9ecef;
//             }
//             .footer-text {
//                 font-size: 12px;
//                 color: #999;
//                 margin-bottom: 10px;
//             }
//             .security-note {
//                 font-size: 12px;
//                 color: #666;
//                 font-style: italic;
//             }
//             .highlight {
//                 color: #c8102e;
//                 font-weight: 600;
//             }
//         </style>
//     </head>
//     <body>
//         <div class="container">
//             <div class="header">
//                 <div class="logo">
//                     <img src="${process.env.BASE_URL || 'http://localhost:3000'}/images/logo.png" alt="Elite Pic Logo" />
//                 </div>
//             </div>
            
//             <div class="content">
//                 <h1 class="title">Verify Your Email Address</h1>
//                 <p class="message">
//                     Thank you for choosing Elite Pic! To complete your registration, 
//                     please use the One-Time Password (OTP) below to verify your email address.
//                 </p>
                
//                 <div class="otp-container">
//                     <div class="otp-label">Your OTP Code</div>
//                     <div class="otp-code">${otp}</div>
//                 </div>
                
//                 <p class="expiry">
//                     <strong>Note:</strong> This OTP will expire in <span class="highlight">10 minutes</span> for security reasons.
//                 </p>
                
//                 <p class="message">
//                     If you didn't request this verification, please ignore this email or 
//                     contact our support team immediately.
//                 </p>
//             </div>
            
//             <div class="footer">
//                 <p class="footer-text">
//                     © 2024 Elite Pic. All rights reserved.
//                 </p>
//                 <p class="security-note">
//                     This is an automated message. Please do not reply to this email.
//                 </p>
//             </div>
//         </div>
//     </body>
//     </html>
//   `;
// };

// const generateCredentialsTemplate = (email, password, loginUrl) => {
//   return `
//     <!DOCTYPE html>
//     <html lang="en">
//     <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <title>Elite Pic - Account Credentials</title>
//         <style>
//             * {
//                 margin: 0;
//                 padding: 0;
//                 box-sizing: border-box;
//             }
//             body {
//                 font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
//                 background-color: #f4f4f4;
//                 padding: 20px;
//             }
//             .container {
//                 max-width: 600px;
//                 margin: 0 auto;
//                 background-color: #ffffff;
//                 border-radius: 10px;
//                 overflow: hidden;
//                 box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
//             }
//             .header {
//                 background: linear-gradient(135deg, #004ca5 0%, #003d82 100%);
//                 padding: 30px;
//                 text-align: center;
//             }
//             .logo {
//                 text-align: center;
//                 margin-bottom: 20px;
//             }
//             .logo img {
//                 max-width: 200px;
//                 height: auto;
//                 border-radius: 8px;
//             }
//             .content {
//                 padding: 40px 30px;
//                 text-align: center;
//             }
//             .title {
//                 font-size: 24px;
//                 color: #333;
//                 margin-bottom: 20px;
//                 font-weight: 600;
//             }
//             .message {
//                 font-size: 16px;
//                 color: #666;
//                 margin-bottom: 30px;
//                 line-height: 1.6;
//             }
//             .credentials-container {
//                 background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
//                 border: 2px solid #004ca5;
//                 border-radius: 10px;
//                 padding: 30px;
//                 margin: 30px 0;
//                 text-align: left;
//             }
//             .credentials-title {
//                 font-size: 18px;
//                 color: #004ca5;
//                 font-weight: 600;
//                 margin-bottom: 20px;
//                 text-align: center;
//                 text-transform: uppercase;
//                 letter-spacing: 1px;
//             }
//             .credential-item {
//                 margin-bottom: 15px;
//                 padding: 15px;
//                 background-color: #fff;
//                 border-radius: 5px;
//                 border-left: 4px solid #c8102e;
//             }
//             .credential-label {
//                 font-size: 14px;
//                 color: #004ca5;
//                 font-weight: 600;
//                 margin-bottom: 5px;
//                 text-transform: uppercase;
//                 letter-spacing: 0.5px;
//             }
//             .credential-value {
//                 font-size: 16px;
//                 color: #333;
//                 font-family: 'Courier New', monospace;
//                 word-break: break-all;
//             }
//             .login-button {
//                 display: inline-block;
//                 background: linear-gradient(135deg, #004ca5 0%, #003d82 100%);
//                 color: #ffffff;
//                 padding: 15px 30px;
//                 text-decoration: none;
//                 border-radius: 5px;
//                 font-weight: 600;
//                 font-size: 16px;
//                 margin: 20px 0;
//                 transition: all 0.3s ease;
//             }
//             .login-button:hover {
//                 background: linear-gradient(135deg, #003d82 0%, #002a5c 100%);
//                 transform: translateY(-2px);
//             }
//             .security-note {
//                 font-size: 14px;
//                 color: #666;
//                 margin-top: 20px;
//                 font-style: italic;
//                 padding: 15px;
//                 background-color: #fff3cd;
//                 border-radius: 5px;
//                 border-left: 4px solid #ffc107;
//             }
//             .footer {
//                 background-color: #f8f9fa;
//                 padding: 20px;
//                 text-align: center;
//                 border-top: 1px solid #e9ecef;
//             }
//             .footer-text {
//                 font-size: 12px;
//                 color: #999;
//                 margin-bottom: 10px;
//             }
//             .highlight {
//                 color: #c8102e;
//                 font-weight: 600;
//             }
//         </style>
//     </head>
//     <body>
//         <div class="container">
//             <div class="header">
//                 <div class="logo">
//                     <img src="${process.env.BASE_URL || 'http://localhost:5000'}/images/logo.png" alt="Elite Pic Logo" />
//                 </div>
//             </div>
            
//             <div class="content">
//                 <h1 class="title">Welcome to Elite Pic!</h1>
//                 <p class="message">
//                     Your email has been successfully verified. Below are your account credentials 
//                     and a direct link to access your dashboard.
//                 </p>
                
//                 <div class="credentials-container">
//                     <div class="credentials-title">Your Login Credentials</div>
                    
//                     <div class="credential-item">
//                         <div class="credential-label">Email Address</div>
//                         <div class="credential-value">${email}</div>
//                     </div>
                    
//                     <div class="credential-item">
//                         <div class="credential-label">Password</div>
//                         <div class="credential-value">${password}</div>
//                     </div>
//                 </div>
                
//                 <a href="${loginUrl}" class="login-button">Access Your Dashboard</a>
                
//                 <div class="security-note">
//                     <strong>Security Notice:</strong> Please keep your credentials safe and do not 
//                     share them with anyone. If you didn't request this email, please contact our 
//                     support team immediately.
//                 </div>
                
//                 <p class="message">
//                     You can now log in and start using all the features of Elite Pic!
//                 </p>
//             </div>
            
//             <div class="footer">
//                 <p class="footer-text">
//                     © 2024 Elite Pic. All rights reserved.
//                 </p>
//                 <p class="footer-text">
//                     This is an automated message. Please do not reply to this email.
//                 </p>
//             </div>
//         </div>
//     </body>
//     </html>
//   `;
// };

// module.exports = {
//   generateOTPTemplate,
//   generateCredentialsTemplate,
// };





const generateOTPTemplate = (otp) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification | Elite Pic</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #f5f5f5;
                line-height: 1.5;
            }
            .email-wrapper {
                max-width: 520px;
                margin: 40px auto;
                padding: 20px;
            }
            .email-card {
                background: #ffffff;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            .email-header {
                background: #1a1a2e;
                padding: 32px 24px;
                text-align: center;
            }
            .email-header h1 {
                color: #ffffff;
                font-size: 24px;
                margin: 0;
                font-weight: 600;
            }
            .email-body {
                padding: 40px 32px;
            }
            .greeting {
                font-size: 16px;
                color: #333333;
                margin-bottom: 20px;
            }
            .message {
                color: #555555;
                font-size: 15px;
                margin-bottom: 28px;
            }
            .otp-box {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                padding: 24px;
                text-align: center;
                margin: 24px 0;
            }
            .otp-label {
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: #6c757d;
                margin-bottom: 12px;
            }
            .otp-code {
                font-size: 40px;
                font-weight: 700;
                letter-spacing: 8px;
                color: #1a1a2e;
                font-family: 'Courier New', monospace;
            }
            .expiry-note {
                font-size: 13px;
                color: #6c757d;
                text-align: center;
                margin-top: 16px;
            }
            .divider {
                height: 1px;
                background: #e9ecef;
                margin: 24px 0;
            }
            .footer-note {
                font-size: 12px;
                color: #adb5bd;
                text-align: center;
                padding: 20px 24px;
                border-top: 1px solid #e9ecef;
                background: #fafafa;
            }
            @media (max-width: 560px) {
                .email-wrapper {
                    margin: 20px auto;
                    padding: 12px;
                }
                .email-body {
                    padding: 28px 20px;
                }
                .otp-code {
                    font-size: 32px;
                    letter-spacing: 4px;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-wrapper">
            <div class="email-card">
                <div class="email-header">
                    <h1>Elite Pic</h1>
                </div>
                
                <div class="email-body">
                    <div class="greeting">Hello,</div>
                    
                    <div class="message">
                        Thanks for signing up! Please use the verification code below to complete your registration.
                    </div>
                    
                    <div class="otp-box">
                        <div class="otp-label">Verification Code</div>
                        <div class="otp-code">${otp}</div>
                    </div>
                    
                    <div class="expiry-note">
                        This code expires in 10 minutes.
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="message" style="font-size: 13px; margin-bottom: 0;">
                        Didn't request this? You can safely ignore this email.
                    </div>
                </div>
                
                <div class="footer-note">
                    &copy; 2024 Elite Pic. All rights reserved.
                </div>
            </div>
        </div>
    </body>
    </html>
  `;
};

const generateCredentialsTemplate = (email, password, loginUrl) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Elite Pic</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #f5f5f5;
                line-height: 1.5;
            }
            .email-wrapper {
                max-width: 520px;
                margin: 40px auto;
                padding: 20px;
            }
            .email-card {
                background: #ffffff;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            .email-header {
                background: #1a1a2e;
                padding: 32px 24px;
                text-align: center;
            }
            .email-header h1 {
                color: #ffffff;
                font-size: 24px;
                margin: 0;
                font-weight: 600;
            }
            .email-body {
                padding: 40px 32px;
            }
            .greeting {
                font-size: 16px;
                color: #333333;
                margin-bottom: 20px;
            }
            .message {
                color: #555555;
                font-size: 15px;
                margin-bottom: 24px;
            }
            .credentials-box {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                padding: 20px;
                margin: 24px 0;
            }
            .credential-row {
                padding: 12px 0;
                border-bottom: 1px solid #e9ecef;
            }
            .credential-row:last-child {
                border-bottom: none;
            }
            .credential-label {
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #6c757d;
                margin-bottom: 4px;
            }
            .credential-value {
                font-size: 15px;
                font-weight: 500;
                color: #1a1a2e;
                word-break: break-all;
                font-family: 'Courier New', monospace;
            }
            .login-button {
                display: inline-block;
                background: #1a1a2e;
                color: #ffffff;
                text-decoration: none;
                padding: 12px 28px;
                border-radius: 6px;
                font-weight: 500;
                font-size: 14px;
                margin: 16px 0 8px;
            }
            .security-alert {
                background: #fff8e7;
                border-left: 3px solid #ffc107;
                padding: 14px 16px;
                font-size: 13px;
                color: #856404;
                margin: 24px 0;
                border-radius: 4px;
            }
            .divider {
                height: 1px;
                background: #e9ecef;
                margin: 24px 0;
            }
            .footer-note {
                font-size: 12px;
                color: #adb5bd;
                text-align: center;
                padding: 20px 24px;
                border-top: 1px solid #e9ecef;
                background: #fafafa;
            }
            @media (max-width: 560px) {
                .email-wrapper {
                    margin: 20px auto;
                    padding: 12px;
                }
                .email-body {
                    padding: 28px 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-wrapper">
            <div class="email-card">
                <div class="email-header">
                    <h1>Welcome to Elite Pic</h1>
                </div>
                
                <div class="email-body">
                    <div class="greeting">Hello,</div>
                    
                    <div class="message">
                        Your account has been successfully created. Here are your login credentials:
                    </div>
                    
                    <div class="credentials-box">
                        <div class="credential-row">
                            <div class="credential-label">Email</div>
                            <div class="credential-value">${email}</div>
                        </div>
                        <div class="credential-row">
                            <div class="credential-label">Password</div>
                            <div class="credential-value">${password}</div>
                        </div>
                    </div>
                    
                    <div style="text-align: center;">
                        <a href="${loginUrl}" class="login-button">Sign In to Your Account</a>
                    </div>
                    
                    <div class="security-alert">
                        <strong>🔒 Keep this email safe</strong><br>
                        These credentials grant access to your account. Never share them with anyone.
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="message" style="font-size: 13px; margin-bottom: 0;">
                        For security, we recommend changing your password after your first login.
                    </div>
                </div>
                
                <div class="footer-note">
                    &copy; 2024 Elite Pic. All rights reserved.
                </div>
            </div>
        </div>
    </body>
    </html>
  `;
};

module.exports = {
  generateOTPTemplate,
  generateCredentialsTemplate,
};
