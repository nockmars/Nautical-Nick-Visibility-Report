/**
 * api/server.js
 *
 * Express backend for:
 *   - Stripe subscription checkout (Checkout Sessions + webhook)
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
const path       = require('path');
const fs         = require('fs');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;

const ALERTS_JSON = path.join(__dirname, '..', 'data', 'alerts.json');

// Stripe — single instance, only if key set (lets dev run without it)
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Resend (email) — single instance
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@nauticalnick.net';

// ── Middleware ─────────────────────────────────────────────────────────────

// Raw body needed for Stripe webhook signature verification — must come BEFORE express.json()
app.use('/api/stripe-webhook', bodyParser.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors());

// Serve static files (index.html, css, js, data, assets, etc.)
app.use(express.static(path.join(__dirname, '..')));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE — Create Checkout Session
//
// Uses Stripe's hosted checkout (no PCI scope for us). We pass the customer's
// email so Stripe can pre-fill it, and `client_reference_id` so the webhook
// can match the subscription back to them.
//
// Requires env vars:
//   STRIPE_SECRET_KEY   — from Stripe dashboard → Developers → API keys
//   STRIPE_PRICE_ID     — the Price (not Product) ID of your subscription
//   STRIPE_WEBHOOK_SECRET — generated when you create the webhook endpoint
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/create-checkout-session', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'valid email required' });
  }

  if (!stripe) {
    return res.status(503).json({
      error: 'Stripe not configured. Set STRIPE_SECRET_KEY in .env',
    });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return res.status(503).json({
      error: 'Stripe price not configured. Set STRIPE_PRICE_ID in .env',
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: email, // used in webhook to tie sub → user
      // Auto-calculate sales tax (requires Stripe Tax enabled in dashboard)
      automatic_tax: { enabled: true },
      // Require billing address for tax calc
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
// STRIPE — Webhook (subscription lifecycle events)
//
// Configure in the Stripe dashboard → Developers → Webhooks:
//   Endpoint URL: https://YOUR-DOMAIN/api/stripe-webhook
//   Events:       checkout.session.completed
//                 customer.subscription.created
//                 customer.subscription.updated
//                 customer.subscription.deleted
//                 invoice.payment_failed
//   Signing secret → STRIPE_WEBHOOK_SECRET env var
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/stripe-webhook', (req, res) => {
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

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_email || session.client_reference_id;
      console.log(`[stripe] New subscriber: ${email} (customer: ${session.customer})`);
      // In production: upsert subscriber in DB, mark active, send welcome email
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      console.log(`[stripe] Sub ${sub.id} status=${sub.status}`);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log(`[stripe] Sub cancelled: ${sub.id}`);
      break;
    }
    case 'invoice.payment_succeeded': {
      const inv = event.data.object;
      console.log(`[stripe] Payment succeeded: invoice ${inv.id} customer ${inv.customer} amount ${inv.amount_paid / 100} ${inv.currency.toUpperCase()}`);
      // In production: mark subscription paid-through for inv.period_end,
      // log revenue for analytics
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      console.log(`[stripe] Payment failed on invoice ${inv.id} for customer ${inv.customer}`);
      // In production: trigger dunning email, revoke access after grace period
      break;
    }
    default:
      console.log(`[stripe] Unhandled event: ${event.type}`);
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
  console.log(`   Stripe:       ${process.env.STRIPE_SECRET_KEY ? '✓ configured' : '✗ not configured'}`);
  console.log(`   Resend:       ${process.env.RESEND_API_KEY ? '✓ configured' : '✗ not configured'}\n`);
});
