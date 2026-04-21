/**
 * api/db.js
 *
 * Minimal JSON-backed user store. Two collections in one file:
 *   - users          (username, email, password_hash, stripe_customer_id, subscription_*)
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
 * Writes are atomic: write to tmp file, then rename.
 *
 * Password hashing: Node's built-in crypto.scrypt (N=2^14, r=8, p=1).
 * Zero dependencies, no native modules, and actually more memory-hard
 * than bcrypt.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-runtime');
const DB_FILE  = path.join(DATA_DIR, 'users.json');

const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// Username rules: 3–24 chars, alphanumeric + underscore + hyphen
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
// Very loose email check (real validation is the "can we email you?" step,
// which we don't need until we reintroduce alerts per-user)
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Bootstrap ────────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadAll() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], sessions: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    raw.users    = raw.users    || [];
    raw.sessions = raw.sessions || [];
    return raw;
  } catch (err) {
    console.error('[db] corrupt users.json — starting fresh:', err.message);
    return { users: [], sessions: [] };
  }
}

function saveAll(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function read() { return loadAll(); }
function write(db) { saveAll(db); }

// ── Password hashing (scrypt) ────────────────────────────────────────────
function hashPassword(plaintext) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plaintext, salt, 64, { N: 1 << 14, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPasswordAgainst(hashString, plaintext) {
  if (!hashString || typeof hashString !== 'string') return false;
  const parts = hashString.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const want = Buffer.from(parts[2], 'hex');
    const got  = crypto.scryptSync(plaintext, salt, want.length, { N: 1 << 14, r: 8, p: 1 });
    return crypto.timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

// ── Users ────────────────────────────────────────────────────────────────
function getUserById(id) {
  const db = read();
  return db.users.find(u => u.id === id) || null;
}

function getUserByUsername(username) {
  if (!username) return null;
  const db = read();
  const lc = username.toLowerCase();
  return db.users.find(u => u.username.toLowerCase() === lc) || null;
}

function getUserByEmail(email) {
  if (!email) return null;
  const db = read();
  const lc = email.toLowerCase();
  return db.users.find(u => u.email && u.email.toLowerCase() === lc) || null;
}

function getUserByStripeCustomer(customerId) {
  const db = read();
  return db.users.find(u => u.stripe_customer_id === customerId) || null;
}

/**
 * Create a new user. Throws on validation / uniqueness errors so the route
 * can turn them into 400s.
 */
function createUser({ username, email, password }) {
  username = String(username || '').trim();
  email    = String(email || '').trim().toLowerCase();
  password = String(password || '');

  if (!USERNAME_RE.test(username)) {
    const err = new Error('Username must be 3–24 chars, letters/numbers/_/-');
    err.code = 'BAD_USERNAME';
    throw err;
  }
  if (!EMAIL_RE.test(email)) {
    const err = new Error('Invalid email address');
    err.code = 'BAD_EMAIL';
    throw err;
  }
  if (password.length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.code = 'BAD_PASSWORD';
    throw err;
  }

  const db = read();
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    const err = new Error('Username is taken');
    err.code = 'USERNAME_TAKEN';
    throw err;
  }
  if (db.users.some(u => u.email && u.email.toLowerCase() === email)) {
    const err = new Error('An account with that email already exists');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }

  const user = {
    id:                              crypto.randomUUID(),
    username,
    email,
    password_hash:                   hashPassword(password),
    created_at:                      Date.now(),
    updated_at:                      Date.now(),
    stripe_customer_id:              null,
    subscription_status:             null,
    subscription_current_period_end: null,
  };
  db.users.push(user);
  write(db);
  return user;
}

function updateUser(id, patch = {}) {
  const db = read();
  const user = db.users.find(u => u.id === id);
  if (!user) return null;
  Object.assign(user, patch, { updated_at: Date.now() });
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
 * Verify a password against the stored hash for a user. Returns the user
 * on success, null on failure. Identifier can be email or username.
 */
function verifyCredentials(identifier, password) {
  if (!identifier || !password) return null;
  const id = String(identifier).trim();
  // Try email first if it looks like one, else username.
  let user = null;
  if (id.includes('@')) user = getUserByEmail(id);
  else                  user = getUserByUsername(id);
  // Fallback: try the other lookup in case a user with an email-looking
  // username exists (unlikely given the regex, but safe)
  if (!user) user = getUserByUsername(id) || getUserByEmail(id);

  if (!user) return null;
  if (!verifyPasswordAgainst(user.password_hash, password)) return null;
  return user;
}

/**
 * Is this user currently Pro?
 */
function isPro(user) {
  if (!user) return false;
  const active = ['active', 'trialing', 'past_due'].includes(user.subscription_status);
  const notExpired = !user.subscription_current_period_end ||
    user.subscription_current_period_end * 1000 > Date.now();
  return active && notExpired;
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
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getUserByStripeCustomer,
  createUser,
  updateUser,
  updateUserByStripeCustomer,
  verifyCredentials,
  isPro,
  // sessions
  createSession,
  getSession,
  deleteSession,
  // paths / constants
  DATA_DIR,
  DB_FILE,
  SESSION_TTL_MS,
};
