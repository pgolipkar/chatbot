// db/setup.js
// ============================================================
// DATABASE SETUP - Creates all tables with sample data
// Run with: node db/setup.js
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/helpdesk.db';

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

console.log('🗄️  Setting up database...');

// ============================================================
// TABLE: users
// In production, replace with your AD/LDAP/HR system
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT,
    manager TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active',        -- active | locked | disabled
    account_locked INTEGER DEFAULT 0,    -- 0 = unlocked, 1 = locked
    failed_login_attempts INTEGER DEFAULT 0,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ============================================================
// TABLE: otp_records
// Stores OTP codes sent to users for verification
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS otp_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    otp_type TEXT NOT NULL,              -- email | sms | authenticator
    action TEXT NOT NULL,                -- password_reset | account_unlock
    is_used INTEGER DEFAULT 0,           -- 0 = not used, 1 = used
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// ============================================================
// TABLE: tickets
// Support tickets created when auth fails or action needed
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number TEXT UNIQUE NOT NULL,  -- e.g. TKT-2024-0001
    user_id INTEGER,
    user_employee_id TEXT,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_department TEXT,
    ticket_type TEXT NOT NULL,           -- password_reset | account_unlock | auth_failed
    priority TEXT DEFAULT 'medium',      -- low | medium | high | critical
    status TEXT DEFAULT 'open',          -- open | in_progress | resolved | closed
    description TEXT NOT NULL,
    auth_failure_reason TEXT,            -- reason if auth failed
    assigned_to TEXT DEFAULT 'SD Team',
    conversation_id TEXT,
    resolution_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// ============================================================
// TABLE: action_logs
// Audit trail of all actions performed
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    action_detail TEXT,
    status TEXT,                         -- success | failed | pending
    performed_by TEXT DEFAULT 'bot',     -- bot | sd_agent | system
    ip_address TEXT,
    conversation_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ============================================================
// TABLE: conversations
// Tracks bot conversation state
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT UNIQUE NOT NULL,
    user_identifier TEXT,
    state TEXT DEFAULT 'initial',        -- initial | identified | otp_sent | authenticated | failed
    action TEXT,                         -- password_reset | account_unlock
    context TEXT,                        -- JSON blob for conversation context
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ============================================================
// SAMPLE DATA - Replace with your real employee data
// ============================================================
console.log('👥 Inserting sample users...');

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users 
    (employee_id, username, full_name, email, department, manager, phone, status, account_locked)
  VALUES 
    (@employee_id, @username, @full_name, @email, @department, @manager, @phone, @status, @account_locked)
`);

const sampleUsers = [
  {
    employee_id: 'EMP001',
    username: 'john.doe',
    full_name: 'John Doe',
    email: 'pgolipkar@gmail.com',  // CHANGE: use real email to receive OTP
    department: 'Engineering',
    manager: 'Jane Smith',
    phone: '+91-9876543210',
    status: 'active',
    account_locked: 1
  },
  {
    employee_id: 'EMP002',
    username: 'jane.smith',
    full_name: 'Jane Smith',
    email: 'jane.smith@yourcompany.com',
    department: 'IT',
    manager: 'Bob Wilson',
    phone: '+91-9876543211',
    status: 'active',
    account_locked: 0
  },
  {
    employee_id: 'EMP003',
    username: 'alice.johnson',
    full_name: 'Alice Johnson',
    email: 'alice.johnson@yourcompany.com',
    department: 'HR',
    manager: 'Bob Wilson',
    phone: '+91-9876543212',
    status: 'active',
    account_locked: 1   // This user is locked for testing
  },
  {
    employee_id: 'EMP004',
    username: 'bob.wilson',
    full_name: 'Bob Wilson',
    email: 'bob.wilson@yourcompany.com',
    department: 'Management',
    manager: 'CEO',
    phone: '+91-9876543213',
    status: 'active',
    account_locked: 0
  }
];

const insertMany = db.transaction((users) => {
  for (const user of users) insertUser.run(user);
});

insertMany(sampleUsers);

console.log('✅ Database setup complete!');
console.log('📍 Database file:', path.resolve(DB_PATH));
console.log('👥 Sample users created:');
sampleUsers.forEach(u => {
  console.log(`   - ${u.full_name} (${u.username}) | Email: ${u.email} | Locked: ${u.account_locked ? 'YES' : 'No'}`);
});

module.exports = db;
