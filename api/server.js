/**
 * api/server.js
 *
 * Express backend:
 *   - Magic-link auth + cookie sessions (api/auth.js, api/db.js)
 *   - Stripe subscription checkout (gated on auth; persists sub state)
 *   - Stripe webhook → updates user subscription_status in DB
 *   - Email alerts (Resend)
 *   - Static file serving in production
 *
 * Cross-origin notes:
 *   If the frontend is on a different origin than the API (e.g.
 *   nauticalnick.net + api.nauticalnick.net), set CORS_ORIGIN in env
 *   to the frontend origin. We enable `credentials: true` so cookies
 *   flow across origins. If same-origin (Express serves everything),
 *   leave CORS_ORIGIN unset.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');

const db   = require('./db');
const auth = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const IS_PROD = BASE.startsWith('https://') || process.env.NODE_ENV === 'production';

const ALERTS_JSON = path.join(__dirname, '..', 'data', 'alerts.json');

// Stripe — single instance, only if key set
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Resend (email)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@nauticalnick.net';

// ── Middleware ─────────────────────────────────────────────────────────────

// Raw body needed for Stripe webhook signature verification — MUST come
// BEFORE express.json() so the webhook handler sees the raw bytes.
app.use('/api/stripe-webhook', bodyParser.raw({ type: 'application/json' }));
app.use(express.json());

// CORS — if frontend is cross-origin, set CORS_ORIGIN to the frontend origin
// (e.g. https://nauticalnick.net). If same-origin, leave unset and cors()
// will be a no-op for same-origin requests anyway.
if (process.env.CORS_ORIGIN) {
  app.use(cors({
    origin:      process.env.CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: true, // send cookies on cross-origin requests
  }));
} else {
  app.use(cors()); // permissive for same-origin / dev
}

// Static files — served AFTER CORS but BEFORE routes so /api/* takes priority
app.use(express.static(path.join(__dirname, '..')));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Auth routes ────────────────────────────────────────────────────────────
app.use('/api', auth.buildRouter({
  resend,
  fromEmail: FROM_EMAIL,
  baseUrl:   BASE,
  isProd:    IS_PROD,
}));

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE — Create Checkout Session
//
// Now requires an authenticated session. The user's DB id is passed as
// client_reference_id so the webhook can match the subscription back to
// their account. The customer's email is pinned to the session user's
// email (can't be spoofed from the request body anymore).
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/create-checkout-session', auth.requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return res.status(503).json({ error: 'Stripe price not configured' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email:      req.user.email,
      client_reference_id: req.user.id,       // ← user ID, not email
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${BASE}/?stripe_success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE}/?stripe_cancelled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] Checkout session error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE — Webhook
//
// Every subscription lifecycle event lands here. We update the user row so
// /api/me returns the correct pro status on the next page load.
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/stripe-webhook', async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe not configured');

  const secret    = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];

  if (!secret || !signature) {
    return res.status(400).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch (err) {
    console.error('[stripe] Webhook signature verification failed:', err.message);
    return res.status(401).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        // client_reference_id is the user.id we set when creating the checkout
        const userId     = s.client_reference_id;
        const customerId = s.customer;
        const email      = s.customer_email || s.customer_details?.email;

        let user = userId ? db.getUserById(userId) : null;
        // Fallback: match by email if id missing (e.g. legacy sessions)
        if (!user && email) user = db.upsertUserByEmail(email);

        if (user) {
          // Attach stripe_customer_id so future subscription events can find
          // this user without needing client_reference_id (it's only on the
          // checkout.session.completed event, not on subscription.* events).
          db.upsertUserByEmail(user.email, { stripe_customer_id: customerId });
          console.log(`[stripe] ✓ Linked customer ${customerId} → user ${user.email}`);
        } else {
          console.warn('[stripe] checkout.session.completed with no user match:', s.id);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const updated = db.updateUserByStripeCustomer(sub.customer, {
          subscription_status:             sub.status,
          subscription_current_period_end: sub.current_period_end,
        });
        console.log(`[stripe] sub.${event.type.split('.').pop()}: customer=${sub.customer} status=${sub.status}` +
          (updated ? ` → user=${updated.email}` : ' (no user match)'));
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const updated = db.updateUserByStripeCustomer(sub.customer, {
          subscription_status: 'canceled',
        });
        console.log(`[stripe] sub.deleted: customer=${sub.customer}` +
          (updated ? ` → user=${updated.email}` : ' (no user match)'));
        break;
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        console.log(`[stripe] payment_succeeded: ${inv.amount_paid / 100} ${inv.currency.toUpperCase()} from ${inv.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        console.log(`[stripe] payment_failed: invoice=${inv.id} customer=${inv.customer}`);
        break;
      }

      default:
        console.log(`[stripe] Unhandled: ${event.type}`);
    }
  } catch (err) {
    console.error('[stripe] Webhook handler error:', err);
    // Still 200 — we don't want Stripe to retry for our own bugs
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS — Set email alert (unchanged)
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

// ── Fallback: serve index.html for any unmatched non-API route ─────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌊 Nautical Nick server running on port ${PORT} (0.0.0.0)`);
  console.log(`   Local:        http://localhost:${PORT}`);
  console.log(`   Base URL:     ${BASE}`);
  console.log(`   Stripe:       ${process.env.STRIPE_SECRET_KEY ? '✓ configured' : '✗ not configured'}`);
  console.log(`   Resend:       ${process.env.RESEND_API_KEY ? '✓ configured' : '✗ not configured'}`);
  console.log(`   DB file:      ${db.DB_FILE}`);
  console.log(`   Prod mode:    ${IS_PROD ? 'yes (secure cookies)' : 'no (plain cookies)'}\n`);
});
