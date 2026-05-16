// bot/claudeAI.js
// ============================================================
// CLAUDE HELPER
// Claude classifies unclear first messages and writes short user-facing
// responses. The bot code still owns the security workflow.
// ============================================================

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

function hasClaudeApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  return Boolean(key && key.trim() && key !== 'your_key_here' && key !== 'YOUR_ANTHROPIC_API_KEY');
}

function getClaudeClient() {
  if (!hasClaudeApiKey()) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function detectIntent(userMessage) {
  const lower = String(userMessage || '').toLowerCase().trim();

  if (lower === '1') return 'password_reset';
  if (lower === '2') return 'account_unlock';

  const passwordKeywords = [
    'forgot', 'forget', 'password', 'reset', 'change password',
    'cant login', "can't login", 'cannot login', 'lost password',
    'new password', 'update password', 'expired password'
  ];
  const unlockKeywords = [
    'locked', 'lock', 'unlock', 'blocked', 'disabled',
    'account locked', 'cant access', "can't access", 'locked out'
  ];
  const greetingKeywords = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'help'];

  if (passwordKeywords.some((keyword) => lower.includes(keyword))) return 'password_reset';
  if (unlockKeywords.some((keyword) => lower.includes(keyword))) return 'account_unlock';
  if (greetingKeywords.some((keyword) => lower.includes(keyword))) return 'greeting';

  const client = getClaudeClient();
  if (!client) return 'other';

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 20,
      system: 'Classify the user request. Reply with only one value: PASSWORD_RESET, ACCOUNT_UNLOCK, GREETING, or OTHER.',
      messages: [{ role: 'user', content: userMessage }]
    });

    const intent = response.content[0].text.trim().toUpperCase();
    if (intent.includes('PASSWORD')) return 'password_reset';
    if (intent.includes('ACCOUNT') || intent.includes('UNLOCK')) return 'account_unlock';
    if (intent.includes('GREETING')) return 'greeting';
    return 'other';
  } catch (error) {
    console.error('Claude intent detection failed:', error.message);
    return 'other';
  }
}

async function generateResponse(situation, params = {}) {
  const fallback = buildFallbackResponses(params)[situation] || "I'm here to help. Please proceed.";
  const prompt = buildPrompt(situation, params);
  const client = getClaudeClient();

  if (!client || !prompt) return fallback;

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 180,
      system: [
        'You are a professional IT Helpdesk assistant inside Microsoft Teams.',
        'You only help with password reset and account unlock.',
        'Keep responses short, plain text, and direct.',
        'Do not say you personally performed security checks; the system does that.'
      ].join(' '),
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text.trim() || fallback;
  } catch (error) {
    console.error('Claude response generation failed:', error.message);
    return fallback;
  }
}

function buildPrompt(situation, params) {
  const prompts = {
    welcome: 'Write a short welcome message. Say the bot can help with 1. Password Reset and 2. Account Unlock. Ask what the user needs.',
    unsupported_request: 'The user asked for something outside password reset and account unlock. Politely redirect them to those two choices.',
    ask_employee_id: `Ask the user for Employee ID, username, or registered email for ${formatAction(params.action)}.`,
    user_not_found: `The identifier "${params.identifier}" was not found. Ask the user to try Employee ID, username, or registered email.`,
    otp_sent: `Tell the user an OTP was sent to ${params.email}. Ask them to enter it. Mention expiry in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.`,
    otp_invalid: `Tell the user the OTP is invalid. They have ${params.attemptsLeft || 1} attempts left.`,
    otp_expired: "Tell the user the OTP expired and they can type 'resend'.",
    auth_max_attempts: 'Tell the user OTP verification failed too many times and a Service Desk ticket is being created.',
    password_reset_success: `Tell ${params.userName || 'the user'} their password reset request is complete.`,
    account_unlock_success: `Tell ${params.userName || 'the user'} their account unlock request is complete.`,
    ticket_created: `Tell the user Service Desk ticket ${params.ticketNumber} was created and IT will contact them at ${params.email}.`
  };

  return prompts[situation];
}

function buildFallbackResponses(params = {}) {
  return {
    welcome: "Hello! I'm your IT Helpdesk Assistant. I can help with:\n\n1. Password Reset\n2. Account Unlock\n\nType 1, 2, or describe what you need.",
    unsupported_request: "I can only help with password reset and account unlock requests. Type 'I forgot my password' or 'My account is locked' to continue.",
    ask_employee_id: `Please share your Employee ID, username, or registered email so I can find your account for ${formatAction(params.action)}.`,
    user_not_found: `I could not find "${params.identifier}". Please try your Employee ID, username, or registered email.`,
    otp_sent: `OTP sent to ${params.email}. Please enter the ${process.env.OTP_LENGTH || 6}-digit code. It expires in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.`,
    otp_invalid: `That OTP is not valid. Please try again. Attempts left: ${params.attemptsLeft || 1}.`,
    otp_expired: "That OTP has expired. Type 'resend' to receive a new OTP.",
    auth_max_attempts: 'OTP verification failed too many times. I am creating a Service Desk ticket for manual help.',
    password_reset_success: 'Your password reset request has been completed.',
    account_unlock_success: 'Your account has been unlocked. You can now try signing in again.',
    ticket_created: `A support ticket (${params.ticketNumber}) has been created. The IT team will contact you soon.`
  };
}

function formatAction(action) {
  if (action === 'password_reset') return 'password reset';
  if (action === 'account_unlock') return 'account unlock';
  return 'your request';
}

module.exports = {
  detectIntent,
  generateResponse,
  hasClaudeApiKey
};
