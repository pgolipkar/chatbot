// auth/otpService.js
// ============================================================
// OTP SERVICE - Generates and sends OTP codes via email
// ============================================================

require('dotenv').config();
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Email transporter setup
// In production: replace with your corporate email service (Exchange, SendGrid, etc.)
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * Generate a random numeric OTP
 * @param {number} length - OTP length (default 6)
 * @returns {string} OTP code
 */
function generateOTP(length = 6) {
  if (process.env.DEFAULT_OTP_CODE) {
    return process.env.DEFAULT_OTP_CODE;
  }

  // Use cryptographically secure random numbers
  const digits = '0123456789';
  let otp = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[randomBytes[i] % 10];
  }
  return otp;
}

/**
 * Send OTP to user via email
 * @param {object} user - User record from DB
 * @param {string} otpCode - The OTP to send
 * @param {string} action - 'password_reset' | 'account_unlock'
 * @returns {object} { success: bool, message: string }
 */
async function sendOTPEmail(user, otpCode, action) {
  const actionText = action === 'password_reset' ? 'Password Reset' : 'Account Unlock';
  const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 5;
  const companyName = process.env.COMPANY_NAME || 'Your Company';

  const emailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: #0078d4; color: white; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; }
        .body { padding: 32px; text-align: center; }
        .otp-box { background: #f0f7ff; border: 2px solid #0078d4; border-radius: 8px; padding: 20px; margin: 24px 0; }
        .otp-code { font-size: 40px; font-weight: bold; color: #0078d4; letter-spacing: 8px; }
        .expiry { color: #d32f2f; font-weight: bold; margin-top: 8px; }
        .warning { background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px; text-align: left; margin-top: 20px; font-size: 13px; color: #555; }
        .footer { background: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #888; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 ${companyName} IT Helpdesk</h1>
          <p style="margin:8px 0 0;">${actionText} Verification</p>
        </div>
        <div class="body">
          <p>Hello <strong>${user.full_name}</strong>,</p>
          <p>Your One-Time Password (OTP) for <strong>${actionText}</strong> is:</p>
          <div class="otp-box">
            <div class="otp-code">${otpCode}</div>
            <div class="expiry">⏱ Expires in ${expiryMinutes} minutes</div>
          </div>
          <p>Enter this code in the MS Teams bot to complete your request.</p>
          <div class="warning">
            ⚠️ <strong>Security Notice:</strong> Never share this OTP with anyone, including IT staff. 
            Our team will never ask for your OTP. If you did not request this, please contact IT immediately.
          </div>
        </div>
        <div class="footer">
          This is an automated message from ${companyName} IT Helpdesk Bot.<br>
          Do not reply to this email.
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || `IT Helpdesk <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: `[${companyName} IT] Your OTP for ${actionText} - ${otpCode}`,
    html: emailHTML,
    text: `Your OTP for ${actionText} is: ${otpCode}\nExpires in ${expiryMinutes} minutes.\nDo not share this with anyone.`
  };

  try {
    // Check if email is configured
    async function sendOTPEmail(user, otpCode, action) {
      const actionText = action === 'password_reset' ? 'Password Reset' : 'Account Unlock';
      const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 5;

      // ── ALWAYS print OTP to terminal in dev mode ──
      console.log('\n' + '='.repeat(50));
      console.log('🔐 OTP GENERATED');
      console.log('='.repeat(50));
      console.log(`👤 User    : ${user.full_name} (${user.username})`);
      console.log(`📧 Email   : ${user.email}`);
      console.log(`🎯 Action  : ${actionText}`);
      console.log(`🔑 OTP CODE: ${otpCode}`);
      console.log(`⏱  Expires : ${expiryMinutes} minutes`);
      console.log('='.repeat(50) + '\n');

      if (process.env.NODE_ENV === 'development' || !process.env.EMAIL_USER || process.env.EMAIL_USER === 'your-helpdesk@gmail.com') {
        return {
          success: true,
          message: `OTP generated (check your terminal/console for the code)`
        };
      }

      // Real email sending (only when EMAIL_USER is properly configured)
      try {
        const transporter = nodemailer.createTransport({
          service: process.env.EMAIL_SERVICE || 'gmail',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });

        await transporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          to: user.email,
          subject: `Your OTP for ${actionText}: ${otpCode}`,
          text: `Your OTP is: ${otpCode}\nExpires in ${expiryMinutes} minutes.`
        });

        return { success: true, message: `OTP sent to ${maskEmail(user.email)}` };
      } catch (error) {
        console.error('❌ Email failed:', error.message);
        return { success: true, message: `OTP generated (check terminal for code)` };
      }
    }

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent to ${user.email}`);
    return { 
      success: true, 
      message: `OTP sent to your registered email: ${maskEmail(user.email)}`
    };
  } catch (error) {
    console.error('❌ Email send failed:', error.message);
    
    // In dev mode, show OTP in console even if email fails
    if (process.env.NODE_ENV === 'development') {
      console.log(`📧 [DEV FALLBACK] OTP for ${user.full_name}: ${otpCode}`);
      return { 
        success: true, 
        message: `OTP generated (dev mode - check server console): ${maskEmail(user.email)}`
      };
    }
    
    return { 
      success: false, 
      message: 'Failed to send OTP email. Please try again or contact IT support.' 
    };
  }
}

/**
 * Mask email for display (privacy)
 * john.doe@company.com → j***e@company.com
 */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

module.exports = { generateOTP, sendOTPEmail, maskEmail };
