// index.js
// ============================================================
// MAIN SERVER - Starts the bot and API endpoints
// ============================================================

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const {
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  createBotFrameworkAuthenticationFromConfiguration
} = require('botbuilder');

const { HelpdeskBot } = require('./bot/helpdeskBot');
const db = require('./db/database');

// ============================================================
// ENSURE DATABASE EXISTS
// ============================================================
const DB_PATH = process.env.DB_PATH || './db/helpdesk.db';
if (!fs.existsSync(DB_PATH)) {
  console.log('📦 Database not found. Running setup...');
  require('./db/setup');
}

// ============================================================
// BOT ADAPTER SETUP (Microsoft Bot Framework)
// ============================================================
const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MicrosoftAppId,
  MicrosoftAppPassword: process.env.MicrosoftAppPassword,
  MicrosoftAppType: 'MultiTenant'
});

const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
const adapter = new CloudAdapter(botFrameworkAuthentication);

// Error handler
adapter.onTurnError = async (context, error) => {
  console.error('❌ Bot Turn Error:', error);
  await context.sendActivity('❌ An unexpected error occurred. Please type "restart" or contact IT support.');
};

// ============================================================
// CREATE BOT INSTANCE
// ============================================================
const bot = new HelpdeskBot();

// ============================================================
// CREATE WEB SERVER
// ============================================================
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files for the admin dashboard
app.use('/public', express.static(path.join(__dirname, 'public')));

// ============================================================
// ROUTES
// ============================================================

// Main bot endpoint - Teams sends all messages here
app.post('/api/messages', async (req, res) => {
  console.log(`📨 Received message from Teams`);
  await adapter.process(req, res, (context) => bot.run(context));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    bot: 'Helpdesk Bot',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// SD TEAM DASHBOARD API ENDPOINTS
// ============================================================

// Get all tickets
app.get('/api/tickets', (req, res) => {
  const status = req.query.status || null;
  const tickets = db.getAllTickets(status);
  res.status(200).json({ tickets, count: tickets.length });
});

// Get dashboard stats
app.get('/api/stats', (req, res) => {
  const stats = db.getDashboardStats();
  res.status(200).json(stats);
});

// Resolve a ticket
app.get('/api/tickets/:ticketNumber/resolve', (req, res) => {
  const { ticketNumber } = req.params;
  // Find ticket by number
  const tickets = db.getAllTickets();
  const ticket = tickets.find(t => t.ticket_number === ticketNumber);
  
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  db.updateTicket(ticket.id, { 
    status: 'resolved', 
    resolved_at: new Date().toISOString(),
    resolution_notes: 'Resolved by SD Agent via Teams notification'
  });
  
  res.status(200).json({ success: true, message: `Ticket ${ticketNumber} marked as resolved` });
});

// Update ticket status (POST)
app.post('/api/tickets/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, resolution_notes, assigned_to } = req.body;
  const ticket = db.getAllTickets().find(t => t.id === parseInt(id));
  
  const updates = {};
  if (status) updates.status = status;
  if (resolution_notes) updates.resolution_notes = resolution_notes;
  if (assigned_to) updates.assigned_to = assigned_to;
  if (status === 'resolved') updates.resolved_at = new Date().toISOString();
  
  db.updateTicket(parseInt(id), updates);
  if (ticket && status) {
    db.logAction(
      ticket.user_id || null,
      ticket.user_name || 'SD Dashboard',
      'ticket_status_changed',
      `Ticket ${ticket.ticket_number} changed from ${ticket.status} to ${status}`,
      'success',
      ticket.conversation_id || null
    );
  }
  res.status(200).json({ success: true });
});

// Get all users (for admin)
app.get('/api/users', (req, res) => {
  // In production: Add authentication here!
  const users = db.getAllUsers();
  res.status(200).json({ users, count: users.length });
});

// Recent bot activity for dashboard
app.get('/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
  const actions = db.getRecentActions(limit);
  res.status(200).json({ actions, count: actions.length });
});

// Recent conversation states for dashboard
app.get('/api/conversations', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
  const conversations = db.getRecentConversations(limit);
  res.status(200).json({ conversations, count: conversations.length });
});

// SD Dashboard HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3978;

const server = app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 HELPDESK BOT SERVER STARTED');
  console.log('='.repeat(60));
  console.log(`📡 Bot endpoint:      http://localhost:${PORT}/api/messages`);
  console.log(`📊 SD Dashboard:      http://localhost:${PORT}`);
  console.log(`❤️  Health check:      http://localhost:${PORT}/health`);
  console.log(`🎫 Tickets API:       http://localhost:${PORT}/api/tickets`);
  console.log('='.repeat(60));
  console.log('\n📝 Next steps:');
  console.log('1. Run ngrok: ngrok http', PORT);
  console.log('2. Set bot endpoint in Azure to: <ngrok-url>/api/messages');
  console.log('3. Add bot to MS Teams channel');
  console.log('\n✅ Bot is ready to receive messages!\n');
});

module.exports = server;
