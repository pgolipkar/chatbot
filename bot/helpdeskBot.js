// bot/helpdeskBot.js
// ============================================================
// TEAMS BOT CONVERSATION HANDLER
// Supports only:
// 1. Password reset
// 2. Account unlock
// ============================================================

require('dotenv').config();
const { ActivityHandler, MessageFactory } = require('botbuilder');
const { detectIntent, generateResponse } = require('./claudeAI');
const { generateOTP, sendOTPEmail } = require('../auth/otpService');
const { createAndNotifyTicket } = require('../tickets/ticketService');
const { resetPassword, unlockAccount } = require('../services/accountActions');
const db = require('../db/database');

const MAX_USER_LOOKUP_ATTEMPTS = Number(process.env.MAX_USER_LOOKUP_ATTEMPTS || 2);
const MAX_OTP_ATTEMPTS = Number(process.env.MAX_OTP_ATTEMPTS || 3);
const OTP_LENGTH = Number(process.env.OTP_LENGTH || 6);
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);

class HelpdeskBot extends ActivityHandler {
  constructor() {
    super();

    this.onConversationUpdate(async (context, next) => {
      const membersAdded = context.activity.membersAdded || [];
      for (const member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await this.startNewSession(context);
        }
      }
      await next();
    });

    this.onMessage(async (context, next) => {
      try {
        await this.handleMessage(context);
      } catch (error) {
        console.error('Bot error:', error);
        await context.sendActivity("Sorry, something went wrong. Type 'restart' to start again, or contact IT support.");
      }
      await next();
    });
  }

  async startNewSession(context) {
    const conversationId = context.activity.conversation.id;
    db.saveConversationState(conversationId, 'initial', null, this.getUserContext(context));
    await context.sendActivity(MessageFactory.text(await generateResponse('welcome')));
  }

  async handleMessage(context) {
    const conversationId = context.activity.conversation.id;
    const userMessage = (context.activity.text || '').trim();
    const lowerMessage = userMessage.toLowerCase();

    if (!userMessage) {
      await context.sendActivity('Please type your request.');
      return;
    }

    if (['restart', 'reset', 'start over', 'cancel'].includes(lowerMessage)) {
      await this.startNewSession(context);
      return;
    }

    const convState = db.getConversationState(conversationId) || { state: 'initial', context: {} };
    const state = convState.state || 'initial';
    const ctx = {
      ...(convState.context || {}),
      ...this.getUserContext(context),
      lastMessage: userMessage
    };

    if (!convState.id) {
      db.saveConversationState(conversationId, 'initial', null, ctx);
      db.logAction(null, ctx.teamsUserName || 'Unknown Teams user', 'chat_started', 'User opened or started a bot chat', 'pending', conversationId);
    }

    console.log(`[${conversationId}] State=${state}, Message="${userMessage}"`);

    switch (state) {
      case 'initial':
        await this.handleInitialState(context, userMessage, conversationId);
        break;
      case 'identifying':
        await this.handleIdentifying(context, userMessage, conversationId, ctx);
        break;
      case 'identifying_failed':
        await this.handleIdentifyingFailed(context, userMessage, conversationId, ctx);
        break;
      case 'otp_sent':
        await this.handleOtpVerification(context, userMessage, conversationId, ctx);
        break;
      case 'completed':
      case 'failed':
        await context.sendActivity("This request is already complete. Type 'restart' to begin a new password reset or account unlock request.");
        break;
      default:
        db.saveConversationState(conversationId, 'initial', null, ctx);
        await this.handleInitialState(context, userMessage, conversationId);
    }
  }

  getUserContext(context) {
    const from = context.activity.from || {};
    return {
      teamsUserId: from.id || null,
      teamsUserName: from.name || from.aadObjectId || 'Unknown Teams user'
    };
  }

  async handleInitialState(context, userMessage, conversationId) {
    await context.sendActivity({ type: 'typing' });

    const intent = await detectIntent(userMessage);

    if (intent === 'greeting') {
      db.saveConversationState(conversationId, 'initial', null, {
        teamsUserName: context.activity.from?.name || 'Unknown Teams user',
        lastMessage: userMessage
      });
      await context.sendActivity(await generateResponse('welcome'));
      return;
    }

    if (!['password_reset', 'account_unlock'].includes(intent)) {
      db.saveConversationState(conversationId, 'initial', null, {
        teamsUserName: context.activity.from?.name || 'Unknown Teams user',
        lastMessage: userMessage
      });
      await context.sendActivity(await generateResponse('unsupported_request'));
      return;
    }

    db.saveConversationState(conversationId, 'identifying', intent, {
      action: intent,
      findAttempts: 0,
      teamsUserName: context.activity.from?.name || 'Unknown Teams user',
      lastMessage: userMessage
    });
    db.logAction(null, context.activity.from?.name || 'Unknown Teams user', intent, 'User started this request in Teams', 'pending', conversationId);

    await context.sendActivity(await generateResponse('ask_employee_id', { action: intent }));
  }

  async handleIdentifying(context, userMessage, conversationId, ctx) {
    await context.sendActivity({ type: 'typing' });

    const action = ctx.action;
    const identifier = userMessage.trim();
    const user = db.findUser(identifier);

    if (!user) {
      const attempts = Number(ctx.findAttempts || 0) + 1;
      const nextContext = { ...ctx, findAttempts: attempts, lastIdentifier: identifier };

      if (attempts >= MAX_USER_LOOKUP_ATTEMPTS) {
        db.saveConversationState(conversationId, 'identifying_failed', action, nextContext);
        await context.sendActivity(
          "I could not find that account in the local user database. Type 'yes' to create a Service Desk ticket, or type another employee ID/username/email to try again."
        );
        return;
      }

      db.saveConversationState(conversationId, 'identifying', action, nextContext);
      await context.sendActivity(await generateResponse('user_not_found', { identifier }));
      return;
    }

    if (user.status === 'disabled') {
      await context.sendActivity('Your account is disabled, so this needs manual Service Desk review.');
      await this.createFailureTicket(context, user, null, action, 'Account is disabled', conversationId);
      return;
    }

    await this.issueOtp(context, conversationId, user, action);
  }

  async handleIdentifyingFailed(context, userMessage, conversationId, ctx) {
    const lowerMessage = userMessage.toLowerCase().trim();

    if (['yes', 'y', 'create ticket', 'ticket'].includes(lowerMessage)) {
      await this.createFailureTicket(
        context,
        null,
        ctx.lastIdentifier || userMessage,
        ctx.action || 'auth_failed',
        'User could not be found in local user database',
        conversationId
      );
      return;
    }

    db.saveConversationState(conversationId, 'identifying', ctx.action, {
      ...ctx,
      findAttempts: Math.max(0, Number(ctx.findAttempts || 1) - 1)
    });
    await this.handleIdentifying(context, userMessage, conversationId, ctx);
  }

  async issueOtp(context, conversationId, user, action) {
    const otpCode = generateOTP(OTP_LENGTH);

    db.saveOTP(user.id, conversationId, otpCode, action, OTP_EXPIRY_MINUTES);
    const emailResult = await sendOTPEmail(user, otpCode, action);

    db.logAction(user.id, user.username, 'otp_requested', `Action: ${action}`, 'success', conversationId);
    db.saveConversationState(conversationId, 'otp_sent', action, {
      action,
      userId: user.id,
      userName: user.full_name,
      userEmail: user.email,
      userDept: user.department,
      otpAttempts: 0
    });

    await context.sendActivity(await generateResponse('otp_sent', { email: emailResult.message }));

    if (!emailResult.success) {
      await context.sendActivity('The OTP email could not be sent. A Service Desk ticket can be created if this continues.');
    }
  }

  async handleOtpVerification(context, userMessage, conversationId, ctx) {
    await context.sendActivity({ type: 'typing' });

    const enteredOtp = userMessage.trim().replace(/\s/g, '');
    const action = ctx.action;
    const user = db.getUserById(ctx.userId);

    if (!user) {
      await context.sendActivity("I could not reload your user record. Type 'restart' and try again.");
      return;
    }

    if (['resend', 'resend otp', 'new otp'].includes(enteredOtp.toLowerCase())) {
      await this.issueOtp(context, conversationId, user, action);
      return;
    }

    if (!/^\d{4,8}$/.test(enteredOtp)) {
      await context.sendActivity(`Please enter the ${OTP_LENGTH}-digit OTP sent to your registered email, or type 'resend'.`);
      return;
    }

    const verification = db.verifyOTP(user.id, enteredOtp, action);
    const attempts = Number(ctx.otpAttempts || 0) + 1;

    if (!verification.valid) {
      db.logAction(user.id, user.username, 'otp_failed', `Attempt ${attempts}/${MAX_OTP_ATTEMPTS}: ${verification.reason}`, 'failed', conversationId);

      if (attempts >= MAX_OTP_ATTEMPTS) {
        await context.sendActivity(await generateResponse('auth_max_attempts'));
        await this.createFailureTicket(context, user, null, action, `OTP verification failed ${attempts} times`, conversationId);
        return;
      }

      db.saveConversationState(conversationId, 'otp_sent', action, {
        ...ctx,
        otpAttempts: attempts
      });

      const attemptsLeft = MAX_OTP_ATTEMPTS - attempts;
      if (verification.reason.toLowerCase().includes('expired')) {
        await context.sendActivity(await generateResponse('otp_expired'));
      } else {
        await context.sendActivity(await generateResponse('otp_invalid', { attemptsLeft }));
      }
      return;
    }

    await context.sendActivity('Identity verified. Processing your request now.');

    if (action === 'password_reset') {
      await this.performPasswordReset(context, user, conversationId);
      return;
    }

    if (action === 'account_unlock') {
      await this.performAccountUnlock(context, user, conversationId);
      return;
    }

    await this.createFailureTicket(context, user, null, 'auth_failed', `Unknown action after OTP: ${action}`, conversationId);
  }

  async performPasswordReset(context, user, conversationId) {
    const result = await resetPassword(user, conversationId);

    if (!result.success) {
      await context.sendActivity('I could not complete the local password reset. I am creating a Service Desk ticket.');
      await this.createFailureTicket(context, user, null, 'password_reset', 'Local password reset action failed', conversationId);
      return;
    }

    db.saveConversationState(conversationId, 'completed', 'password_reset', { userId: user.id });
    await context.sendActivity(await generateResponse('password_reset_success', { userName: user.full_name }));

    if (result.delivery === 'chat') {
      await context.sendActivity(
        `Local demo temporary password: ${result.tempPassword}\n\n`
      );
    }

    await context.sendActivity("Done. Type 'restart' if you need another password reset or account unlock.");
  }

  async performAccountUnlock(context, user, conversationId) {
    const result = await unlockAccount(user, conversationId);

    if (!result.success) {
      await context.sendActivity('I could not complete the local account unlock. I am creating a Service Desk ticket.');
      await this.createFailureTicket(context, user, null, 'account_unlock', 'Local account unlock action failed', conversationId);
      return;
    }

    db.saveConversationState(conversationId, 'completed', 'account_unlock', { userId: user.id });
    await context.sendActivity(await generateResponse('account_unlock_success', { userName: user.full_name }));
    await context.sendActivity("Done. Type 'restart' if you need another password reset or account unlock.");
  }

  async createFailureTicket(context, user, userInput, action, reason, conversationId) {
    const ticket = await createAndNotifyTicket({
      user,
      userInput,
      ticketType: user ? action : 'auth_failed',
      authFailureReason: reason,
      conversationId
    });

    db.saveConversationState(conversationId, 'failed', action, {
      ticketNumber: ticket.ticket_number
    });

    await context.sendActivity(await generateResponse('ticket_created', {
      ticketNumber: ticket.ticket_number,
      email: user ? user.email : 'the contact details available to Service Desk'
    }));
    await context.sendActivity(`Ticket reference: ${ticket.ticket_number}. Assigned to: ${ticket.assigned_to || 'SD Team'}. Priority: ${ticket.priority}.`);
  }
}

module.exports.HelpdeskBot = HelpdeskBot;
