const generateOTPTemplate = (otp) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elite Pic - OTP Verification</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f4f4f4;
                padding: 20px;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
                background: linear-gradient(135deg, #004ca5 0%, #003d82 100%);
                padding: 30px;
                text-align: center;
            }
            .logo {
                text-align: center;
                margin-bottom: 20px;
            }
            .logo img {
                max-width: 200px;
                height: auto;
                border-radius: 8px;
            }
            .content {
                padding: 40px 30px;
                text-align: center;
            }
            .title {
                font-size: 24px;
                color: #333;
                margin-bottom: 20px;
                font-weight: 600;
            }
            .message {
                font-size: 16px;
                color: #666;
                margin-bottom: 30px;
                line-height: 1.6;
            }
            .otp-container {
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border: 2px solid #004ca5;
                border-radius: 10px;
                padding: 20px;
                margin: 30px 0;
                display: inline-block;
            }
            .otp-label {
                font-size: 14px;
                color: #004ca5;
                font-weight: 600;
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .otp-code {
                font-size: 36px;
                font-weight: bold;
                color: #c8102e;
                letter-spacing: 8px;
                font-family: 'Courier New', monospace;
            }
            .expiry {
                font-size: 14px;
                color: #666;
                margin-top: 20px;
                font-style: italic;
            }
            .footer {
                background-color: #f8f9fa;
                padding: 20px;
                text-align: center;
                border-top: 1px solid #e9ecef;
            }
            .footer-text {
                font-size: 12px;
                color: #999;
                margin-bottom: 10px;
            }
            .security-note {
                font-size: 12px;
                color: #666;
                font-style: italic;
            }
            .highlight {
                color: #c8102e;
                font-weight: 600;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">
                    <img src="public/images/logo.png" alt="Elite Pic Logo" />
                </div>
            </div>
            
            <div class="content">
                <h1 class="title">Verify Your Email Address</h1>
                <p class="message">
                    Thank you for choosing Elite Pic! To complete your registration, 
                    please use the One-Time Password (OTP) below to verify your email address.
                </p>
                
                <div class="otp-container">
                    <div class="otp-label">Your OTP Code</div>
                    <div class="otp-code">${otp}</div>
                </div>
                
                <p class="expiry">
                    <strong>Note:</strong> This OTP will expire in <span class="highlight">10 minutes</span> for security reasons.
                </p>
                
                <p class="message">
                    If you didn't request this verification, please ignore this email or 
                    contact our support team immediately.
                </p>
            </div>
            
            <div class="footer">
                <p class="footer-text">
                    © 2024 Elite Pic. All rights reserved.
                </p>
                <p class="security-note">
                    This is an automated message. Please do not reply to this email.
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
};

const generateCredentialsTemplate = (email, password, loginUrl) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elite Pic - Account Credentials</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f4f4f4;
                padding: 20px;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
                background: linear-gradient(135deg, #004ca5 0%, #003d82 100%);
                padding: 30px;
                text-align: center;
            }
            .logo {
                text-align: center;
                margin-bottom: 20px;
            }
            .logo img {
                max-width: 200px;
                height: auto;
                border-radius: 8px;
            }
            .content {
                padding: 40px 30px;
                text-align: center;
            }
            .title {
                font-size: 24px;
                color: #333;
                margin-bottom: 20px;
                font-weight: 600;
            }
            .message {
                font-size: 16px;
                color: #666;
                margin-bottom: 30px;
                line-height: 1.6;
            }
            .credentials-container {
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border: 2px solid #004ca5;
                border-radius: 10px;
                padding: 30px;
                margin: 30px 0;
                text-align: left;
            }
            .credentials-title {
                font-size: 18px;
                color: #004ca5;
                font-weight: 600;
                margin-bottom: 20px;
                text-align: center;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .credential-item {
                margin-bottom: 15px;
                padding: 15px;
                background-color: #fff;
                border-radius: 5px;
                border-left: 4px solid #c8102e;
            }
            .credential-label {
                font-size: 14px;
                color: #004ca5;
                font-weight: 600;
                margin-bottom: 5px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .credential-value {
                font-size: 16px;
                color: #333;
                font-family: 'Courier New', monospace;
                word-break: break-all;
            }
            .login-button {
                display: inline-block;
                background: linear-gradient(135deg, #004ca5 0%, #003d82 100%);
                color: #ffffff;
                padding: 15px 30px;
                text-decoration: none;
                border-radius: 5px;
                font-weight: 600;
                font-size: 16px;
                margin: 20px 0;
                transition: all 0.3s ease;
            }
            .login-button:hover {
                background: linear-gradient(135deg, #003d82 0%, #002a5c 100%);
                transform: translateY(-2px);
            }
            .security-note {
                font-size: 14px;
                color: #666;
                margin-top: 20px;
                font-style: italic;
                padding: 15px;
                background-color: #fff3cd;
                border-radius: 5px;
                border-left: 4px solid #ffc107;
            }
            .footer {
                background-color: #f8f9fa;
                padding: 20px;
                text-align: center;
                border-top: 1px solid #e9ecef;
            }
            .footer-text {
                font-size: 12px;
                color: #999;
                margin-bottom: 10px;
            }
            .highlight {
                color: #c8102e;
                font-weight: 600;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">
                    <img src="public/images/logo.png" alt="Elite Pic Logo" />
                </div>
            </div>
            
            <div class="content">
                <h1 class="title">Welcome to Elite Pic!</h1>
                <p class="message">
                    Your email has been successfully verified. Below are your account credentials 
                    and a direct link to access your dashboard.
                </p>
                
                <div class="credentials-container">
                    <div class="credentials-title">Your Login Credentials</div>
                    
                    <div class="credential-item">
                        <div class="credential-label">Email Address</div>
                        <div class="credential-value">${email}</div>
                    </div>
                    
                    <div class="credential-item">
                        <div class="credential-label">Password</div>
                        <div class="credential-value">${password}</div>
                    </div>
                </div>
                
                <a href="${loginUrl}" class="login-button">Access Your Dashboard</a>
                
                <div class="security-note">
                    <strong>Security Notice:</strong> Please keep your credentials safe and do not 
                    share them with anyone. If you didn't request this email, please contact our 
                    support team immediately.
                </div>
                
                <p class="message">
                    You can now log in and start using all the features of Elite Pic!
                </p>
            </div>
            
            <div class="footer">
                <p class="footer-text">
                    © 2024 Elite Pic. All rights reserved.
                </p>
                <p class="footer-text">
                    This is an automated message. Please do not reply to this email.
                </p>
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
