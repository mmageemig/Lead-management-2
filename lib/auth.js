'use strict';
const crypto = require('crypto');
const { db, newId } = require('./db');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const suppliedBuffer = crypto.scryptSync(password, salt, 64);
    return hashBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
  } catch (e) {
    return false;
  }
}

function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * SESSION_DAYS).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').run(id, userId, expiresAt);
  return { id, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * SESSION_DAYS) };
}

function getSessionUser(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare('SELECT s.expires_at as sess_expires, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sessionId);
  if (!row) return null;
  if (new Date(row.sess_expires).getTime() < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  return row;
}

function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
}

function countAdmins() {
  const row = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
  return row.c;
}

function createUser({ role, name, email, phone, password }) {
  const id = newId('u');
  const password_hash = hashPassword(password);
  db.prepare(`INSERT INTO users (id, role, name, email, phone, password_hash) VALUES (?,?,?,?,?,?)`)
    .run(id, role, name, email.trim(), phone || null, password_hash);
  return id;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  destroySession,
  findUserByEmail,
  countAdmins,
  createUser,
};
