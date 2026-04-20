/**
 * api/server.js
 *
 * Express backend for:
 *   - LemonSqueezy subscription checkout (hosted checkout link + webhook)
 *   - Email alert registration (Resend)
 *   - Magic-link sign-in stubs
 *   - Static file serving in production
 *
 * Deploy on any Node host (Railway, Render, Fly.io). Set BASE_URL to your
 * public domain. Static frontend is served from the project root.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const crypto     = require('crypto');
const path       = require('path');
const fs         = require('fs');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;

const ALERTS_JSON = path.join(__dirname, '..', 'data', 'alerts.json');

// Resend (email) — single instance
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@nauticalnick.net';

// ── Middleware ─────────────────────────────────────────────────────────────

// Raw body needed for LemonSqueezy webhook HMAC verification
app.use('/api/ls-webhook', bodyParser.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors());

// Serve static files (index.html, css, js, data, assets, etc.)
app.use(express.static(path.join(__dirname, '..')));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════
// LEMONSQUEEZY — Redirect to hosted checkout
//
// LemonSqueezy gives you a permalink per variant (product). We append the
// user's email + a `checkout[custom][user_email]` field so the webhook can
// match the resulting subscription back to them.
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/create-checkout-session', (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'valid email required' });
  }

  const variantUrl = process.env.LS_CHECKOUT_URL; // e.g. https://nauticalnick.lemonsqueezy.com/buy/xxxxx
  if (!variantUrl) {
    return res.status(503).json({
      error: 'LemonSqueezy not configured. Set LS_CHECKOUT_URL in .env',
    });
  }

  const url = new URL(variantUrl);
  url.searchParams.set('checkout[email]', email);
  url.searchParams.set('checkout[custom][user_email]', email);
  // Return customer to the homepage with a success flag
  url.searchParams.set('checkout[success_url]', `${BASE}/?ls_success=1&email=${encodeURIComponent(email)}`);

  res.json({ url: url.toString() });
});

// ═══════════════════════════════════════════════════════════════════════════
// LEMONSQUEEZY — Webhook (subscription lifecycle events)
//
// Configure in the LemonSqueezy dashboard:
//   URL:     https://YOUR-DOMAIN/api/ls-webhook
//   Events:  subscription_created, subscription_updated, subscription_cancelled
//   Secret:  random string, also set as LS_WEBHOOK_SECRET in .env
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/ls-webhook', (req, res) => {
  const secret    = process.env.LS_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'];

  if (!secret || !signature) {
    return res.status(400).send('Webhook not configured');
  }

  // Verify HMAC-SHA256 signature
  const digest = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const digBuf = Buffer.from(digest, 'hex');

  if (sigBuf.length !== digBuf.length || !crypto.timingSafeEqual(sigBuf, digBuf)) {
    return res.status(401).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).send('Invalid JSON');
  }

  const eventName = event.meta && event.meta.event_name;
  const email     = event.data?.attributes?.user_email
                 || event.meta?.custom_data?.user_email;

  switch (eventName) {
    case 'subscription_created':
      console.log(`[ls] New subscriber: ${email}`);
      // In production: write the subscription + status to a database
      break;
    case 'subscription_updated':
      console.log(`[ls] Subscription updated: ${email} (status: ${event.data?.attributes?.status})`);
      break;
    case 'subscription_cancelled':
    case 'subscription_expired':
      console.log(`[ls] Subscription ended: ${email}`);
      break;
    default:
      console.log(`[ls] Unhandled event: ${eventName}`);
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS — Set email alert
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/alerts/set', async (req, res) => {
  const { email, threshold, region } = req.body;

  if (!email || !threshold) {
    return res.status(400).json({ error: 'email and threshold required' });
  }

  if (!email.includes('@') || email.length < 5) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const threshNum = parseInt(threshold, 10);
  if (![15, 20, 25, 30].includes(threshNum)) {
    return res.status(400).json({ error: 'threshold must be 15, 20, 25, or 30' });
  }

  const regionSlug = region || 'san-diego';

  let data = { alerts: [] };
  if (fs.existsSync(ALERTS_JSON)) {
    try { data = JSON.parse(fs.readFileSync(ALERTS_JSON, 'utf8')); } catch {}
  }

  // Match on email + region (one alert per region per email)
  const existing = data.alerts.find(a => a.email === email && a.region === regionSlug);
  if (existing) {
    existing.threshold = threshNum;
    existing.updatedAt = new Date().toISOString();
  } else {
    data.alerts.push({
      id:           uuidv4(),
      email,
      region:       regionSlug,
      threshold:    threshNum,
      createdAt:    new Date().toISOString(),
      lastSentDate: null,
    });
  }

  fs.writeFileSync(ALERTS_JSON, JSON.stringify(data, null, 2));

  // Send a confirmation email
  if (resend) {
    try {
      await resend.emails.send({
        from:    `Nautical Nick <${FROM_EMAIL}>`,
        to:      email,
        subject: `🌊 Alert set — ${prettyRegion(regionSlug)} ${threshNum}ft+`,
        html:    confirmationEmailHtml(regionSlug, threshNum),
      });
    } catch (err) {
      console.warn('[resend] Confirmation email failed:', err.message);
    }
  }

  res.json({
    message: `✓ Alert set! You'll get an email when ${prettyRegion(regionSlug)} visibility hits ${threshNum}ft.`,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH — Magic link sign-in (stub)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/send-magic-link', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  // TODO: look up subscriber in a DB, mint a signed JWT, email the link
  console.log(`[auth] Magic link requested for: ${email}`);

  if (resend) {
    try {
      await resend.emails.send({
        from:    `Nautical Nick <${FROM_EMAIL}>`,
        to:      email,
        subject: '🔑 Your Nautical Nick sign-in link',
        html:    `<p>Click below to sign in to your Nautical Nick subscription:</p>
                  <p><a href="${BASE}/?token=TODO">Sign in</a></p>`,
      });
    } catch (err) {
      console.warn('[resend] Magic link send failed:', err.message);
    }
  }

  res.json({ message: 'Check your inbox — a sign-in link is on its way.' });
});

// ── Helpers ────────────────────────────────────────────────────────────────
function prettyRegion(slug) {
  const map = {
    'san-diego':       'San Diego',
    'orange-county':   'Orange County',
    'la-county':       'Los Angeles County',
    'catalina-island': 'Catalina Island',
  };
  return map[slug] || slug;
}

function confirmationEmailHtml(regionSlug, threshold) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#0d3347; max-width:520px;">
      <h2 style="color:#0d3347; margin:0 0 12px;">🌊 Alert confirmed</h2>
      <p>You're set. We'll send you an email the next time <strong>${prettyRegion(regionSlug)}</strong> visibility hits <strong>${threshold}ft</strong> or better.</p>
      <p>You'll get at most one email per day per region.</p>
      <p style="margin-top:24px;font-size:12px;color:#6a9ab0;">
        Manage alerts: <a href="${BASE}">nauticalnick.net</a>
      </p>
    </div>
  `;
}

// ── Fallback: serve index.html for any unmatched route ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌊 Nautical Nick server running on port ${PORT} (0.0.0.0)`);
  console.log(`   Local:        http://localhost:${PORT}`);
  console.log(`   LemonSqueezy: ${process.env.LS_CHECKOUT_URL ? '✓ configured' : '✗ not configured'}`);
  console.log(`   Resend:       ${process.env.RESEND_API_KEY ? '✓ configured' : '✗ not configured'}\n`);
});
