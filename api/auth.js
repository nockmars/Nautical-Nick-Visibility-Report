/**
 * api/auth.js
 *
 * Passwordless auth via magic link + HttpOnly cookie session.
 *
 * Flow:
 *   1. User submits email           → POST /api/auth/login
 *      Server mints single-use token, emails link with ?auth=<token>.
 *
 *   2. User clicks link → frontend  → GET /api/auth/verify?token=...
 *      Server consumes token, creates session, sets HttpOnly cookie,
 *      redirects back to BASE_URL. (GET + redirect so it works from email
 *      clients that can't do POST.)
 *
 *   3. Frontend calls                 GET /api/me
 *      Returns { email, pro } for the cookie-identified user, or
 *      { authenticated: false } if no session.
 *
 *   4. Logout                       → POST /api/auth/logout
 *      Clears cookie, deletes session row.
 *
 * Security notes:
 *   - Tokens are 32 bytes from crypto.randomBytes (no enumeration risk).
 *   - Tokens are single-use and expire in 15 min.
 *   - Session cookie is HttpOnly (no JS access), Secure in prod,
 *     SameSite=Lax (allows top-level nav from email link).
 *   - Do not leak whether an email exists — always respond "check your inbox."
 */

const express = require('express');
const cookie  = require('cookie');
const db      = require('./db');

const COOKIE_NAME = 'naut_session';

function buildRouter({ resend, fromEmail, baseUrl, isProd }) {
  const router = express.Router();

  // ── POST /api/auth/login ───────────────────────────────────────────────
  // Body: { email }
  // Response: { ok: true } regardless of whether the email exists.
  router.post('/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'valid email required' });
    }

    const token = db.createLoginToken(email);
    const link  = `${baseUrl}/api/auth/verify?token=${token}`;

    if (!resend) {
      // Dev fallback: if no email provider, log the link so you can
      // click through locally without SMTP setup.
      console.log(`[auth] (no Resend configured) magic link for ${email}:\n  ${link}`);
    } else {
      try {
        await resend.emails.send({
          from:    `Nautical Nick <${fromEmail}>`,
          to:      email,
          subject: '🔑 Your Nautical Nick sign-in link',
          html:    magicLinkEmailHtml(link),
        });
      } catch (err) {
        console.warn('[auth] Resend send failed:', err.message);
        // Don't leak to the client — still return ok.
      }
    }

    res.json({ ok: true, message: 'Check your inbox for a sign-in link.' });
  });

  // ── GET /api/auth/verify?token=... ─────────────────────────────────────
  // Consume token → create session → set cookie → redirect to /.
  router.get('/auth/verify', (req, res) => {
    const token = String(req.query.token || '');
    const consumed = db.consumeLoginToken(token);

    if (!consumed) {
      return res.redirect(`${baseUrl}/?auth_error=1`);
    }

    const user = db.upsertUserByEmail(consumed.email);
    const sid  = db.createSession(user.id);

    res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, sid, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'lax',
      path:     '/',
      maxAge:   Math.floor(db.SESSION_TTL_MS / 1000),
    }));

    res.redirect(`${baseUrl}/?auth_ok=1`);
  });

  // ── POST /api/auth/logout ──────────────────────────────────────────────
  router.post('/auth/logout', (req, res) => {
    const sid = readSessionId(req);
    if (sid) db.deleteSession(sid);

    res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'lax',
      path:     '/',
      maxAge:   0,
    }));
    res.json({ ok: true });
  });

  // ── GET /api/me ────────────────────────────────────────────────────────
  // Canonical source of truth for "am I logged in / am I pro?"
  router.get('/me', (req, res) => {
    const sid = readSessionId(req);
    const s   = db.getSession(sid);
    if (!s) return res.json({ authenticated: false });

    res.json({
      authenticated:      true,
      email:              s.user.email,
      pro:                db.isPro(s.user),
      subscriptionStatus: s.user.subscription_status || null,
      currentPeriodEnd:   s.user.subscription_current_period_end || null,
    });
  });

  return router;
}

// ── Middleware exported for other routes ─────────────────────────────────
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

function magicLinkEmailHtml(link) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0d3347; max-width:520px;">
      <h2 style="color:#0d3347; margin:0 0 12px;">🌊 Sign in to Nautical Nick</h2>
      <p>Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
      <p style="margin:24px 0;">
        <a href="${link}" style="
          display:inline-block; background:#1e5f8a; color:#fff; text-decoration:none;
          padding:12px 24px; border-radius:8px; font-weight:600;
        ">Sign in</a>
      </p>
      <p style="font-size:12px; color:#6a9ab0;">
        Or copy this link: <br/>
        <span style="word-break:break-all;">${link}</span>
      </p>
      <p style="font-size:12px; color:#6a9ab0; margin-top:24px;">
        Didn't request this? You can safely ignore this email.
      </p>
    </div>
  `;
}

module.exports = { buildRouter, requireAuth, optionalAuth, COOKIE_NAME };
