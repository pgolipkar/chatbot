// db/database.js
// ============================================================
// DATABASE LAYER - All DB operations go through here
// Swap this file's internals when connecting to real DB
// ============================================================

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/helpdesk.db';

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Connect to database (creates file if doesn't exist)
let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
} catch (err) {
  console.error('❌ Database connection failed. Run: node db/setup.js first');
  console.error(err.message);
}

// ============================================================
// USER OPERATIONS
// ============================================================

/**
 * Find user by employee ID, username, or email
 * @param {string} identifier - Can be employee_id, username, or email
 * @returns {object|null} User record or null
 */
function findUser(identifier) {
  if (!db) return null;
  const stmt = db.prepare(`
    SELECT * FROM users 
    WHERE employee_id = ? OR username = ? OR email = ?
    LIMIT 1
  `);
  return stmt.get(identifier, identifier, identifier) || null;
}

/**
 * Get user by ID
 */
function getUserById(id) {
  if (!db) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

/**
 * Get all local users for admin/testing.
 * In production, replace this with your HR/AD directory lookup.
 */
function getAllUsers() {
  if (!db) return [];
  return db.prepare(`
    SELECT id, employee_id, username, full_name, email, department, manager,
           phone, status, account_locked, failed_login_attempts, updated_at
    FROM users
    ORDER BY full_name ASC
  `).all();
}

/**
 * Update user account status
 * @param {number} userId 
 * @param {object} updates - { account_locked, status, failed_login_attempts }
 */
function updateUser(userId, updates) {
  if (!db) return false;
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), new Date().toISOString(), userId];
  db.prepare(`UPDATE users SET ${fields}, updated_at = ? WHERE id = ?`).run(...values);
  return true;
}

/**
 * Unlock user account
 */
function unlockUserAccount(userId) {
  return updateUser(userId, {
    account_locked: 0,
    failed_login_attempts: 0,
    status: 'active'
  });
}

/**
 * Reset user password (in real system, this would call AD/LDAP)
 * For now, we log it and mark as reset
 */
function resetUserPassword(userId, newPasswordHash) {
  if (!db) return false;
  // In production: call Active Directory API or LDAP here
  db.prepare(`
    UPDATE users SET 
      updated_at = ?,
      failed_login_attempts = 0
    WHERE id = ?
  `).run(new Date().toISOString(), userId);
  return true;
}

// ============================================================
// OTP OPERATIONS
// ============================================================

/**
 * Save OTP to database
 */
function saveOTP(userId, conversationId, otpCode, action, expiryMinutes = 5) {
  if (!db) return false;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
  
  // Invalidate any existing OTPs for this user+action
  db.prepare(`
    UPDATE otp_records SET is_used = 1 
    WHERE user_id = ? AND action = ? AND is_used = 0
  `).run(userId, action);

  // Insert new OTP
  db.prepare(`
    INSERT INTO otp_records (user_id, conversation_id, otp_code, otp_type, action, expires_at)
    VALUES (?, ?, ?, 'email', ?, ?)
  `).run(userId, conversationId, otpCode, action, expiresAt);
  
  return true;
}

/**
 * Verify OTP - checks code, expiry, and marks as used
 * @returns {object} { valid: bool, reason: string }
 */
function verifyOTP(userId, otpCode, action) {
  if (!db) return { valid: false, reason: 'Database error' };
  
  const record = db.prepare(`
    SELECT * FROM otp_records 
    WHERE user_id = ? AND otp_code = ? AND action = ? AND is_used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, otpCode, action);

  if (!record) {
    return { valid: false, reason: 'Invalid OTP code. Please check and try again.' };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, reason: 'OTP has expired. Please request a new one.' };
  }

  // Mark OTP as used
  db.prepare('UPDATE otp_records SET is_used = 1 WHERE id = ?').run(record.id);
  
  return { valid: true, reason: 'OTP verified successfully' };
}

// ============================================================
// TICKET OPERATIONS
// ============================================================

/**
 * Generate unique ticket number
 */
function generateTicketNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const seq = db.prepare('SELECT COUNT(*) as count FROM tickets').get().count + 1;
  return `TKT-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Create a support ticket
 */
function createTicket(ticketData) {
  if (!db) return null;
  
  const ticketNumber = generateTicketNumber();
  const priority = determinePriority(ticketData.ticket_type, ticketData.auth_failure_reason);
  const assignedTo = ticketData.assigned_to || process.env.DEFAULT_SD_ASSIGNMENT || 'SD Team';
  
  const result = db.prepare(`
    INSERT INTO tickets (
      ticket_number, user_id, user_employee_id, user_name, user_email,
      user_department, ticket_type, priority, status, description,
      auth_failure_reason, assigned_to, conversation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
  `).run(
    ticketNumber,
    ticketData.user_id || null,
    ticketData.user_employee_id || null,
    ticketData.user_name,
    ticketData.user_email,
    ticketData.user_department || 'Unknown',
    ticketData.ticket_type,
    priority,
    ticketData.description,
    ticketData.auth_failure_reason || null,
    assignedTo,
    ticketData.conversation_id || null
  );

  return {
    id: result.lastInsertRowid,
    ticket_number: ticketNumber,
    ...ticketData,
    priority,
    assigned_to: assignedTo
  };
}

/**
 * Get all tickets (for SD team dashboard)
 */
function getAllTickets(status = null) {
  if (!db) return [];
  if (status) {
    return db.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
}

/**
 * Update ticket status
 */
function updateTicket(ticketId, updates) {
  if (!db) return false;
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), new Date().toISOString(), ticketId];
  db.prepare(`UPDATE tickets SET ${fields}, updated_at = ? WHERE id = ?`).run(...values);
  return true;
}

// ============================================================
// ACTION LOG OPERATIONS
// ============================================================

/**
 * Log an action for audit trail
 */
function logAction(userId, username, action, detail, status, conversationId = null) {
  if (!db) return;
  db.prepare(`
    INSERT INTO action_logs (user_id, username, action, action_detail, status, conversation_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, action, detail, status, conversationId);
}

/**
 * Get recent bot actions for dashboard activity feed.
 */
function getRecentActions(limit = 25) {
  if (!db) return [];
  return db.prepare(`
    SELECT id, user_id, username, action, action_detail, status,
           performed_by, conversation_id, created_at
    FROM action_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

// ============================================================
// CONVERSATION STATE OPERATIONS
// ============================================================

/**
 * Save/update conversation state
 */
function saveConversationState(conversationId, state, action, context) {
  if (!db) return;
  const existing = db.prepare('SELECT id FROM conversations WHERE conversation_id = ?').get(conversationId);
  
  if (existing) {
    db.prepare(`
      UPDATE conversations SET state = ?, action = ?, context = ?, updated_at = ?
      WHERE conversation_id = ?
    `).run(state, action, JSON.stringify(context), new Date().toISOString(), conversationId);
  } else {
    db.prepare(`
      INSERT INTO conversations (conversation_id, state, action, context)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, state, action, JSON.stringify(context));
  }
}

/**
 * Get conversation state
 */
function getConversationState(conversationId) {
  if (!db) return null;
  const record = db.prepare('SELECT * FROM conversations WHERE conversation_id = ?').get(conversationId);
  if (record && record.context) {
    try { record.context = JSON.parse(record.context); } catch (e) { record.context = {}; }
  }
  return record;
}

/**
 * Get active/recent conversations for dashboard visibility.
 */
function getRecentConversations(limit = 25) {
  if (!db) return [];
  const records = db.prepare(`
    SELECT id, conversation_id, user_identifier, state, action, context,
           created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);

  return records.map((record) => {
    if (record.context) {
      try { record.context = JSON.parse(record.context); } catch (e) { record.context = {}; }
    } else {
      record.context = {};
    }
    return record;
  });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function determinePriority(ticketType, failureReason) {
  if (ticketType === 'account_unlock') return 'high';
  if (failureReason && failureReason.includes('multiple')) return 'high';
  return 'medium';
}

/**
 * Get stats for dashboard
 */
function getDashboardStats() {
  if (!db) return {};
  return {
    total_tickets: db.prepare('SELECT COUNT(*) as c FROM tickets').get().c,
    open_tickets: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c,
    resolved_tickets: db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'resolved'").get().c,
    total_users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    locked_accounts: db.prepare("SELECT COUNT(*) as c FROM users WHERE account_locked = 1").get().c,
    today_actions: db.prepare("SELECT COUNT(*) as c FROM action_logs WHERE date(created_at) = date('now')").get().c
  };
}

module.exports = {
  findUser,
  getUserById,
  getAllUsers,
  updateUser,
  unlockUserAccount,
  resetUserPassword,
  saveOTP,
  verifyOTP,
  createTicket,
  getAllTickets,
  updateTicket,
  logAction,
  getRecentActions,
  saveConversationState,
  getConversationState,
  getRecentConversations,
  getDashboardStats
};
