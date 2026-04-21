/**
 * api/db.js
 *
 * Minimal JSON-backed user store. Three collections in one file:
 *   - users          (email, stripe_customer_id, subscription_*)
 *   - login_tokens   (short-lived magic-link tokens; single-use)
 *   - sessions       (long-lived browser sessions; cookie-backed)
 *
 * Why JSON and not Postgres/SQLite?
 *   - MVP scale (< few thousand users). Fits in RAM many times over.
 *   - No native modules → dead-simple Railway build.
 *   - One file = trivial backup.
 *
 * For durability on Railway, mount a persistent Volume at DATA_DIR.
 * Locally it just writes to ./data-runtime.
 *
 * Writes are atomic: write to tmp file, then rename. Renames on the
 * same filesystem are atomic on POSIX and on NTFS via ReplaceFile.
 */

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, '..', 'data-runtime');
const DB_FILE   = path.join(DATA_DIR, 'users.json');

// Token/session lifetimes
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;          // 15 minutes
const SESSION_TTL_MS     = 60 * 24 * 60 * 60 * 1000; // 60 days

// ── Bootstrap ────────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadAll() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], loginTokens: [], sessions: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    raw.users       = raw.users       || [];
    raw.loginTokens = raw.loginTokens || [];
    raw.sessions    = raw.sessions    || [];
    return raw;
  } catch (err) {
    console.error('[db] corrupt users.json — starting fresh:', err.message);
    return { users: [], loginTokens: [], sessions: [] };
  }
}

function saveAll(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Everything reads/writes through these to keep the single-file model simple.
// For our scale, full-file rewrite on each mutation is fine (users.json stays
// small). If this ever becomes hot, migrate to SQLite or Postgres.
function read() { return loadAll(); }
function write(db) { saveAll(db); }

// ── Users ────────────────────────────────────────────────────────────────
function getUserByEmail(email) {
  const db = read();
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

function getUserById(id) {
  const db = read();
  return db.users.find(u => u.id === id) || null;
}

function getUserByStripeCustomer(customerId) {
  const db = read();
  return db.users.find(u => u.stripe_customer_id === customerId) || null;
}

function upsertUserByEmail(email, patch = {}) {
  const db = read();
  const lc = email.toLowerCase();
  let user = db.users.find(u => u.email.toLowerCase() === lc);
  if (!user) {
    user = {
      id:                              crypto.randomUUID(),
      email:                           lc,
      created_at:                      Date.now(),
      stripe_customer_id:              null,
      subscription_status:             null,
      subscription_current_period_end: null,
    };
    db.users.push(user);
  }
  Object.assign(user, patch);
  user.updated_at = Date.now();
  write(db);
  return user;
}

function updateUserByStripeCustomer(customerId, patch = {}) {
  const db = read();
  const user = db.users.find(u => u.stripe_customer_id === customerId);
  if (!user) return null;
  Object.assign(user, patch, { updated_at: Date.now() });
  write(db);
  return user;
}

/**
 * Is this user currently Pro?
 *
 * Truth table:
 *   status = 'active' or 'trialing' → pro
 *   status = 'past_due'             → pro (until grace ends via subscription_current_period_end)
 *   otherwise                       → not pro
 *
 * We also require current_period_end > now so a stale "active" never lingers.
 */
function isPro(user) {
  if (!user) return false;
  const active  = ['active', 'trialing', 'past_due'].includes(user.subscription_status);
  const notExpired = !user.subscription_current_period_end ||
    user.subscription_current_period_end * 1000 > Date.now();
  return active && notExpired;
}

// ── Login tokens (magic link) ────────────────────────────────────────────
function createLoginToken(email) {
  const db = read();
  const token = crypto.randomBytes(32).toString('hex');
  db.loginTokens.push({
    token,
    email:      email.toLowerCase(),
    expires_at: Date.now() + LOGIN_TOKEN_TTL_MS,
    used:       false,
  });
  // Opportunistically clean out expired tokens
  db.loginTokens = db.loginTokens.filter(t => t.expires_at > Date.now() && !t.used);
  write(db);
  return token;
}

function consumeLoginToken(token) {
  const db = read();
  const row = db.loginTokens.find(t => t.token === token);
  if (!row)               return null;
  if (row.used)           return null;
  if (row.expires_at < Date.now()) return null;
  row.used = true;
  write(db);
  return { email: row.email };
}

// ── Sessions ─────────────────────────────────────────────────────────────
function createSession(userId) {
  const db = read();
  const id = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    id,
    user_id:    userId,
    created_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL_MS,
  });
  // Clean expired sessions
  db.sessions = db.sessions.filter(s => s.expires_at > Date.now());
  write(db);
  return id;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const db = read();
  const s = db.sessions.find(x => x.id === sessionId);
  if (!s) return null;
  if (s.expires_at < Date.now()) return null;
  const user = db.users.find(u => u.id === s.user_id);
  if (!user) return null;
  return { session: s, user };
}

function deleteSession(sessionId) {
  const db = read();
  db.sessions = db.sessions.filter(s => s.id !== sessionId);
  write(db);
}

module.exports = {
  // users
  getUserByEmail,
  getUserById,
  getUserByStripeCustomer,
  upsertUserByEmail,
  updateUserByStripeCustomer,
  isPro,
  // tokens
  createLoginToken,
  consumeLoginToken,
  // sessions
  createSession,
  getSession,
  deleteSession,
  // paths (for logging)
  DATA_DIR,
  DB_FILE,
  SESSION_TTL_MS,
};
