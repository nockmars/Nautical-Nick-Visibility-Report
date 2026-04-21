/**
 * api/auth.js
 *
 * Username + password auth with HttpOnly cookie sessions.
 *
 * Routes:
 *   POST /api/auth/register   { username, email, password } → creates account, signs in
 *   POST /api/auth/login      { identifier, password }      → signs in (identifier = email or username)
 *   POST /api/auth/logout                                   → clears cookie + deletes session
 *   GET  /api/me                                            → current session info
 *
 * Security notes:
 *   - Passwords hashed with scrypt (see db.js).
 *   - Session cookie is HttpOnly, Secure in prod, SameSite=Lax, 60 days.
 *   - Login timing is not explicitly constant, but scrypt dominates and
 *     is constant for a given hash. Failed logins still run scrypt against
 *     a dummy hash to avoid a timing side channel that would reveal
 *     whether a username exists.
 *   - Register returns generic "try a different one" on conflicts to
 *     avoid confirming which field conflicted (username vs email).
 */

const express = require('express');
const cookie  = require('cookie');
const db      = require('./db');

const COOKIE_NAME = 'naut_session';

function buildRouter({ isProd }) {
  const router = express.Router();

  // ── POST /api/auth/register ────────────────────────────────────────────
  router.post('/auth/register', async (req, res) => {
    const { username, email, password } = req.body || {};

    let user;
    try {
      user = db.createUser({ username, email, password });
    } catch (err) {
      // Map validation errors to stable 400s
      const status = 400;
      switch (err.code) {
        case 'BAD_USERNAME':
        case 'BAD_EMAIL':
        case 'BAD_PASSWORD':
          return res.status(status).json({ error: err.message });
        case 'USERNAME_TAKEN':
        case 'EMAIL_TAKEN':
          // Intentionally vague — don't confirm which field conflicted.
          return res.status(status).json({
            error: 'That username or email is already in use.',
          });
        default:
          console.error('[auth] register error:', err);
          return res.status(500).json({ error: 'Could not create account' });
      }
    }

    const sid = db.createSession(user.id);
    setSessionCookie(res, sid, isProd);
    res.json({ ok: true, username: user.username, email: user.email });
  });

  // ── POST /api/auth/login ───────────────────────────────────────────────
  router.post('/auth/login', async (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.email || req.body?.username || '').trim();
    const password   = String(req.body?.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/email and password required' });
    }

    const user = db.verifyCredentials(identifier, password);
    if (!user) {
      // Burn cycles to keep login timing roughly constant regardless of
      // whether the user existed.
      try { require('crypto').scryptSync(password, 'nautical-nick-dummy-salt', 64, { N: 1 << 14, r: 8, p: 1 }); }
      catch {}
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sid = db.createSession(user.id);
    setSessionCookie(res, sid, isProd);
    res.json({ ok: true, username: user.username, email: user.email });
  });

  // ── POST /api/auth/logout ──────────────────────────────────────────────
  router.post('/auth/logout', (req, res) => {
    const sid = readSessionId(req);
    if (sid) db.deleteSession(sid);
    clearSessionCookie(res, isProd);
    res.json({ ok: true });
  });

  // ── GET /api/me ────────────────────────────────────────────────────────
  router.get('/me', (req, res) => {
    const sid = readSessionId(req);
    const s   = db.getSession(sid);
    if (!s) return res.json({ authenticated: false });

    res.json({
      authenticated:      true,
      username:           s.user.username,
      email:              s.user.email,
      pro:                db.isPro(s.user),
      subscriptionStatus: s.user.subscription_status || null,
      currentPeriodEnd:   s.user.subscription_current_period_end || null,
    });
  });

  return router;
}

// ── Middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const sid = readSessionId(req);
  const s = db.getSession(sid);
  if (!s) return res.status(401).json({ error: 'authentication required' });
  req.user    = s.user;
  req.session = s.session;
  next();
}

function optionalAuth(req, res, next) {
  const sid = readSessionId(req);
  const s = db.getSession(sid);
  if (s) {
    req.user    = s.user;
    req.session = s.session;
  }
  next();
}

// ── Internal helpers ─────────────────────────────────────────────────────
function readSessionId(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parsed = cookie.parse(raw);
  return parsed[COOKIE_NAME] || null;
}

function setSessionCookie(res, sid, isProd) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, sid, {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'lax',
    path:     '/',
    maxAge:   Math.floor(db.SESSION_TTL_MS / 1000),
  }));
}

function clearSessionCookie(res, isProd) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'lax',
    path:     '/',
    maxAge:   0,
  }));
}

module.exports = { buildRouter, requireAuth, optionalAuth, COOKIE_NAME };
