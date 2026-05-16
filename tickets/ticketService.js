// tickets/ticketService.js
// ============================================================
// TICKET SERVICE - Creates tickets and notifies SD team via Teams webhook
// ============================================================

require('dotenv').config();
const axios = require('axios');
const db = require('../db/database');

/**
 * Create a ticket and notify the SD team via MS Teams webhook
 * @param {object} params
 * @returns {object} Created ticket
 */
async function createAndNotifyTicket(params) {
  const {
    user,            // User object from DB (may be null if unidentified)
    userInput,       // What user typed (for unidentified users)
    ticketType,      // 'password_reset' | 'account_unlock' | 'auth_failed'
    authFailureReason, // Why auth failed
    conversationId   // Bot conversation ID
  } = params;

  // Build ticket data
  const ticketData = {
    user_id: user ? user.id : null,
    user_employee_id: user ? user.employee_id : 'UNKNOWN',
    user_name: user ? user.full_name : (userInput || 'Unknown User'),
    user_email: user ? user.email : 'unknown@company.com',
    user_department: user ? user.department : 'Unknown',
    ticket_type: ticketType,
    assigned_to: process.env.DEFAULT_SD_ASSIGNMENT || 'SD Team',
    auth_failure_reason: authFailureReason || null,
    conversation_id: conversationId,
    description: buildDescription(ticketType, user, authFailureReason)
  };

  // Save to database
  const ticket = db.createTicket(ticketData);
  
  // Log the action
  if (user) {
    db.logAction(
      user.id, 
      user.username, 
      'ticket_created', 
      `Ticket ${ticket.ticket_number} created: ${ticketType}`,
      'success',
      conversationId
    );
  }

  // Send notification to SD team via MS Teams webhook
  await notifySDTeam(ticket, user);

  return ticket;
}

/**
 * Send notification to SD team via MS Teams Incoming Webhook
 * Adaptive Card format for rich Teams message
 */
async function notifySDTeam(ticket, user) {
  const webhookUrl = process.env.SD_TEAM_WEBHOOK_URL;
  
  if (!webhookUrl || webhookUrl.includes('YOUR_WEBHOOK')) {
    console.log(`📢 [DEV] Would notify SD team: Ticket ${ticket.ticket_number}`);
    return;
  }

  const priorityColor = {
    low: '00AA00',
    medium: 'FF8C00', 
    high: 'D32F2F',
    critical: '8B0000'
  }[ticket.priority] || 'FF8C00';

  const typeEmoji = {
    password_reset: '🔑',
    account_unlock: '🔓',
    auth_failed: '🚫'
  }[ticket.ticket_type] || '🎫';

  // MS Teams Adaptive Card message
  const adaptiveCard = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: 'emphasis',
            items: [{
              type: 'ColumnSet',
              columns: [
                {
                  type: 'Column',
                  width: 'stretch',
                  items: [{
                    type: 'TextBlock',
                    text: `${typeEmoji} New Helpdesk Ticket`,
                    weight: 'Bolder',
                    size: 'Large',
                    color: 'Accent'
                  }, {
                    type: 'TextBlock',
                    text: ticket.ticket_number,
                    weight: 'Bolder',
                    size: 'Medium',
                    spacing: 'None'
                  }]
                },
                {
                  type: 'Column',
                  width: 'auto',
                  items: [{
                    type: 'TextBlock',
                    text: ticket.priority.toUpperCase(),
                    weight: 'Bolder',
                    color: ticket.priority === 'high' ? 'Attention' : 'Warning'
                  }]
                }
              ]
            }]
          },
          {
            type: 'FactSet',
            facts: [
              { title: '👤 User:', value: ticket.user_name },
              { title: '📧 Email:', value: ticket.user_email },
              { title: '🏢 Department:', value: ticket.user_department },
              { title: '🎫 Type:', value: formatTicketType(ticket.ticket_type) },
              { title: '📋 Status:', value: 'OPEN - Needs Attention' },
              { title: '⏰ Created:', value: new Date().toLocaleString() }
            ]
          },
          {
            type: 'TextBlock',
            text: '📝 Description:',
            weight: 'Bolder',
            spacing: 'Medium'
          },
          {
            type: 'TextBlock',
            text: ticket.description,
            wrap: true,
            spacing: 'None',
            color: 'Default'
          },
          ...(ticket.auth_failure_reason ? [{
            type: 'Container',
            style: 'attention',
            items: [{
              type: 'TextBlock',
              text: `⚠️ Auth Failure: ${ticket.auth_failure_reason}`,
              wrap: true,
              color: 'Attention'
            }]
          }] : [])
        ],
        actions: [
          {
            type: 'Action.OpenUrl',
            title: '✅ Mark Resolved',
            url: `http://localhost:3978/api/tickets/${ticket.ticket_number}/resolve`
          }
        ]
      }
    }]
  };

  try {
    await axios.post(webhookUrl, adaptiveCard);
    console.log(`✅ SD Team notified for ticket ${ticket.ticket_number}`);
  } catch (error) {
    console.error(`❌ Teams webhook failed: ${error.message}`);
    // Ticket is still created even if webhook fails
  }
}

/**
 * Build a descriptive ticket description
 */
function buildDescription(ticketType, user, authFailureReason) {
  const timestamp = new Date().toLocaleString();
  
  if (ticketType === 'auth_failed') {
    return `User authentication failed via MS Teams Helpdesk Bot at ${timestamp}.\n` +
           `Reason: ${authFailureReason || 'Multiple failed OTP attempts'}\n` +
           `Action Requested: ${user ? (user.account_locked ? 'Account Unlock' : 'Password Reset') : 'Manual verification required'}\n` +
           `Please verify user identity through alternate means and assist accordingly.`;
  }
  
  if (ticketType === 'password_reset') {
    return `Password reset requested by ${user ? user.full_name : 'user'} via MS Teams Helpdesk Bot at ${timestamp}.\n` +
           `Authentication could not be completed automatically.\n` +
           `Please contact the user at their registered email to reset their password manually.`;
  }
  
  if (ticketType === 'account_unlock') {
    return `Account unlock requested by ${user ? user.full_name : 'user'} via MS Teams Helpdesk Bot at ${timestamp}.\n` +
           `Authentication could not be completed automatically.\n` +
           `Please unlock the account after verifying user identity.`;
  }
  
  return `Helpdesk request submitted via MS Teams Bot at ${timestamp}.`;
}

function formatTicketType(type) {
  const map = {
    password_reset: 'Password Reset',
    account_unlock: 'Account Unlock',
    auth_failed: 'Auth Failed - Manual Review'
  };
  return map[type] || type;
}

module.exports = { createAndNotifyTicket, notifySDTeam };
