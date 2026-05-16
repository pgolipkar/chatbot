// services/accountActions.js
// ============================================================
// ACCOUNT ACTION SERVICE
// Local demo mode updates SQLite. Replace these functions later
// with Active Directory, LDAP, Microsoft Graph, or IAM API calls.
// ============================================================

const db = require('../db/database');

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function resetPassword(user, conversationId) {
  const tempPassword = generateTempPassword();

  // LOCAL MODE:
  // This does not change a real corporate password. It only records the
  // action in the local SQLite database so the end-to-end flow can be tested.
  const success = db.resetUserPassword(user.id, tempPassword);

  db.logAction(
    user.id,
    user.username,
    'password_reset',
    success ? 'Local password reset completed' : 'Local password reset failed',
    success ? 'success' : 'failed',
    conversationId
  );

  return {
    success,
    tempPassword,
    delivery: process.env.NODE_ENV === 'production' ? 'email' : 'chat'
  };
}

async function unlockAccount(user, conversationId) {
  const success = db.unlockUserAccount(user.id);

  db.logAction(
    user.id,
    user.username,
    'account_unlock',
    success ? 'Local account unlock completed' : 'Local account unlock failed',
    success ? 'success' : 'failed',
    conversationId
  );

  return { success };
}

module.exports = {
  resetPassword,
  unlockAccount
};
