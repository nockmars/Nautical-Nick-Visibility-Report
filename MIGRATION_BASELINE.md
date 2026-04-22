# Migration Baseline Checklist

**Captured:** 2026-04-22 from `vanilla-js-baseline` tag (`c62d9e4`)
**Purpose:** Verify nothing is lost when migrating vanilla JS → Next.js. Tick each box only after testing it on the new stack.

---

## ✅ Functional Features (verify each works post-migration)

### Public (no login required)
- [ ] Region dropdown switches between 4 SoCal regions (San Diego + 3 placeholders)
- [ ] AI Daily Analysis panel renders summary + timestamp
- [ ] Today's Conditions: visibility number, starfish ratings, 4 source cards (chlorophyll, pier cam, surf, JustGetWet)
- [ ] Scripps Pier Cam snapshots: 3 daily captures (7 AM / 9 AM / 12 PM) with piling labels (SD only)
- [ ] Spot grid: 17 SD spots with vis bar, range, confidence, trend arrow, factor chips
- [ ] Spot detail modal opens on click — shows hero photo, OSM map, vis number, range, descriptor (free tier)
- [ ] 14-day history bar chart (Chart.js) renders per region
- [ ] Region selection persists in localStorage (`REGION_KEY`)
- [ ] About section: profile photo + YouTube link

### Auth
- [ ] Sign up: username (3–24 alphanum + `_-`) + email + password (8+) → account created, cookie set
- [ ] Login: email OR username + password → cookie set
- [ ] Logout: clears `naut_session` cookie
- [ ] `GET /api/me` returns `{ authenticated, email, pro, subscriptionStatus, currentPeriodEnd }`
- [ ] Cookie is httpOnly, Secure (in prod), SameSite=Lax, 60-day TTL
- [ ] Login fails generically when email/username doesn't exist (no user enumeration leak)
- [ ] Password hashing: scrypt with timing-safe comparison
- [ ] Header account chip toggles based on auth state (body classes `.signed-in`, `.subscribed`)

### Paywall (Pro gating)
- [ ] Spot modal gated tiles hidden for free users: chlorophyll, swell, wind, rain, factors, starfish rating, seasonal fish (4 cards), hunting tips, 14-day prediction
- [ ] Alerts panel locked for free users
- [ ] Factor chip details hidden on public spot cards for free users
- [ ] Pro detection: `subscription_status` ∈ `[active, trialing, past_due]` AND `current_period_end` not expired

### Stripe Checkout
- [ ] "Subscribe" button → if not signed in, opens login modal first
- [ ] If signed in: `POST /api/create-checkout-session` → redirects to Stripe Checkout
- [ ] Checkout session uses `client_reference_id: user.id`, pinned `customer_email`, `automatic_tax: true`
- [ ] Stripe redirect: `?stripe_success=1&session_id=...` → polls `/api/me` ~6× to detect unlock → toast confirmation
- [ ] Webhook `POST /api/stripe-webhook` verifies signature with `STRIPE_WEBHOOK_SECRET`
- [ ] Webhook handles: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded/failed`
- [ ] Successful subscription updates `stripe_customer_id`, `subscription_status`, `subscription_current_period_end` in users.json

### Email Alerts
- [ ] `POST /api/alerts/set` accepts `{ email, threshold, region }` → writes to alerts.json + sends Resend confirmation
- [ ] Daily `send-alerts.js` cron checks each subscriber's threshold for their region → sends Resend email if met
- [ ] One alert per email+region per day (`lastSentDate` enforces)

---

## 🌐 Pages / Routes

### Frontend
- [ ] `/` — single-page app (`index.html`) — all functionality lives here
- [ ] `/*` (any non-`/api/*`) — fallback to `index.html` (SPA-style)
- [ ] **No client-side router** — single static page, all sections always in DOM
- [ ] Stripe redirect handled via URL params: `?stripe_success=1&session_id=...`

### Backend (Express, `api/server.js`)
- [ ] `GET  /api/health` — `{ status: "ok", ts: ISO }`
- [ ] `POST /api/auth/register` — body `{ username, email, password }`
- [ ] `POST /api/auth/login` — body `{ identifier, password }` (email or username)
- [ ] `POST /api/auth/logout` — clears session
- [ ] `GET  /api/me` — returns auth + subscription state
- [ ] `POST /api/create-checkout-session` — auth required → returns `{ url }`
- [ ] `POST /api/stripe-webhook` — raw body, signature verified
- [ ] `POST /api/alerts/set` — body `{ email, threshold, region }`

---

## 🔌 External Integrations

### Anthropic (Claude API)
- [ ] SDK: `@anthropic-ai/sdk@0.52.0`
- [ ] Env: `ANTHROPIC_API_KEY` (GitHub Actions + Railway)
- [ ] Used by: `scripts/generate-summary.js` (text), `scripts/capture-pier-cam.js` (vision)
- [ ] Verify: daily AI summary generates; pier cam piling labels populate

### Stripe
- [ ] Env: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (Railway)
- [ ] Webhook URL registered in Stripe dashboard → `/api/stripe-webhook`
- [ ] Test card `4242 4242 4242 4242` completes full flow → DB updated → UI unlocks

### Resend
- [ ] Env: `RESEND_API_KEY`, `FROM_EMAIL`, `BASE_URL` (Railway + GitHub Actions)
- [ ] `FROM_EMAIL` domain verified in Resend dashboard
- [ ] Confirmation emails on alert subscription
- [ ] Daily cron sends alert emails when thresholds met

### NASA Earthdata (satellite fallback)
- [ ] Env: `NASA_EARTHDATA_USER`, `NASA_EARTHDATA_PASS` (GitHub Actions only)
- [ ] HTTP Basic Auth to oceandata.sci.gsfc.nasa.gov ERDDAP
- [ ] Only invoked if NOAA CoastWatch + NOAA West Coast both fail

### NOAA CoastWatch + NOAA West Coast (primary satellite)
- [ ] No auth, no env vars
- [ ] MODIS Aqua daily (`erdMH1chla1day`) — primary
- [ ] VIIRS NPP daily (`noaacwNPPVIIRSSQchlaDaily`) — fallback #1

### Open-Meteo
- [ ] No auth, free tier
- [ ] Marine API (swell, period, direction) — `fetch-surf.js`
- [ ] Forecast API (rain history, weather) — `fetch-weather.js`

### JustGetWet (scraper, SD-only)
- [ ] cheerio HTML parser, no API
- [ ] Targets: `justgetwet.com/category/san-diego/` + fallback to root
- [ ] Graceful fallback if no visibility mention found

### Scripps Pier Cam
- [ ] Puppeteer screenshot from `coollab.ucsd.edu/pierviz/`
- [ ] Run 3× daily via separate workflows

### GitHub Actions (cron orchestration)
- [ ] `daily-update.yml` — cron `30 15 * * *` (8:30 AM PDT) runs full pipeline
- [ ] `capture-7am.yml`, `capture-9am.yml`, `capture-12pm.yml` — pier cam captures
- [ ] All workflows commit results back to `main`
- [ ] Required secrets: `ANTHROPIC_API_KEY`, `NASA_EARTHDATA_USER`, `NASA_EARTHDATA_PASS`, `RESEND_API_KEY`, `FROM_EMAIL`, `BASE_URL`

### Railway (hosting)
- [ ] `railway.json` configures Nixpacks builder
- [ ] Healthcheck: `GET /api/health`
- [ ] **CRITICAL:** Persistent Volume mounted at `/data`, env `DATA_DIR=/data` — without this, every redeploy wipes accounts

### Cloudflare
- [ ] DNS only for `nauticalnick.net` (no API integration)

---

## 🗄️ Database Schema (JSON file store, `data-runtime/users.json`)

### `users[]`
```js
{
  id: "uuid",
  username: "string",                          // 3-24 chars, alphanum + _-
  email: "string (lowercase)",
  password_hash: "scrypt$salt$hash",
  created_at: number,                          // Date.now()
  updated_at: number,
  stripe_customer_id: "cus_..." | null,
  subscription_status: "active" | "trialing" | "past_due" | "canceled" | null,
  subscription_current_period_end: number | null  // Unix timestamp (seconds)
}
```

### `sessions[]`
```js
{
  id: "64-byte hex",
  user_id: "uuid",
  created_at: number,
  expires_at: number                           // 60-day TTL
}
```

### Read-only static data files
- [ ] `data/regions.json` — 4 regions × ~16 spots (name, coords, maxDepth, type)
- [ ] `data/spot-details.json` — premium content (spearing rating, seasonal fish, tips, predictions) — 60KB
- [ ] `data/conditions.json` — current conditions (regenerated daily)
- [ ] `data/history.json` — 14-day rolling history (appended daily)
- [ ] `data/snapshots.json` — pier cam metadata (3× daily updates)
- [ ] `data/snapshots/*.jpg` — pier cam image files
- [ ] `data/alerts.json` — email alert subscriptions

---

## 🔧 Environment Variables (full list)

| Var | Required by | Set in |
|-----|-------------|--------|
| `ANTHROPIC_API_KEY` | scripts | GH Actions + Railway |
| `STRIPE_SECRET_KEY` | api/server.js | Railway |
| `STRIPE_PRICE_ID` | api/server.js | Railway |
| `STRIPE_WEBHOOK_SECRET` | api/server.js | Railway |
| `RESEND_API_KEY` | api/server.js + scripts | Railway + GH Actions |
| `FROM_EMAIL` | api/server.js + scripts | Railway + GH Actions |
| `BASE_URL` | api/server.js + scripts | Railway + GH Actions |
| `NASA_EARTHDATA_USER` | scripts/fetch-satellite.js | GH Actions only |
| `NASA_EARTHDATA_PASS` | scripts/fetch-satellite.js | GH Actions only |
| `NODE_ENV` | api/server.js (secure cookie flag) | Railway (`production`) |
| `PORT` | api/server.js | Railway (auto) |
| `DATA_DIR` | api/db.js | Railway (`/data`, MUST mount Volume) |
| `CORS_ORIGIN` | api/server.js | Railway (only if cross-origin) |

---

## 🛠️ NPM Scripts (must continue to work)

- [ ] `npm start` / `npm run dev` — `node api/server.js`
- [ ] `npm run capture` — pier cam capture (Puppeteer + Claude Vision)
- [ ] `npm run satellite` — chlorophyll fetch
- [ ] `npm run surf` — swell + wind fetch
- [ ] `npm run scrape` — JustGetWet scrape
- [ ] `npm run summary` — Claude AI synthesis
- [ ] `npm run alerts` — send threshold-met emails
- [ ] `npm run update` — orchestrator (runs all in sequence)

---

## 🚧 Known Bugs Carrying Over

- [ ] **Bug:** `js/app.js:~508` reads `f.impact` but `compute-visibility.js` writes `f.direction` — factor chip color-coding broken on public spot cards. Trivial rename. Fix during migration.
- [ ] **Bug:** `applyAuthUi()` doesn't refresh open spot modal lock state if user signs in while modal is open. Edge case, low priority.

---

## 🎯 NOT Yet Built (planned features — confirm none silently appear or disappear)

### Must-do before public launch
- [ ] Railway Persistent Volume mount + `DATA_DIR=/data` (otherwise accounts wipe on redeploy)
- [ ] Verify all GitHub Actions secrets are set (manual workflow trigger test)
- [ ] End-to-end Stripe test with `4242 4242 4242 4242`

### Nice-to-have / roadmap
- [ ] Beach photos per spot (currently emoji fallback) — `imageUrl` field in regions.json
- [ ] Water quality / HAB scrapers for OC, LA, Catalina (parity with SD's JustGetWet)
- [ ] Server-verified alerts tied to user accounts (currently email-only, no user link)
- [ ] Stream gauge runoff data (better rain penalty near river mouths) — Phase 3
- [ ] NASA PACE hyperspectral upgrade (replaces MODIS/VIIRS) — Phase 3
- [ ] Nationwide expansion — Phase 4

### Explicitly rejected — must NOT appear in Next.js version
- ❌ Comments / feedback feature
- ❌ SMS alerts (replaced by Resend email)
- ❌ Client-side localStorage paywall (replaced by server-verified cookies)
- ❌ Magic-link auth (replaced by username/password)

---

## 🎨 Static Assets

- [ ] `css/style.css` — 1920 lines, dark-teal ocean theme, all custom (no Tailwind/Bootstrap)
- [ ] `assets/profile.jpg` — 2.5MB Nautical Nick photo, clipped to circle in header
- [ ] Google Fonts: Bebas Neue, Russo One, Exo 2 (CDN)
- [ ] Chart.js (CDN)
- [ ] Inline SVG icons (eye, location pin, starfish)

---

## 📌 Migration Verification Workflow

After Next.js migration:
1. Walk this entire checklist top-to-bottom on the new stack
2. For each unchecked item, either:
   - Tick it (works on Next.js), or
   - Open a GitHub issue describing what regressed
3. Compare data pipeline output: run `npm run update` on baseline tag, then on new branch — `data/conditions.json` should produce semantically equivalent output
4. Compare DOM: side-by-side screenshots of key panels (use `preview_screenshot`)
5. Test paywall: free user vs Pro user, every gated section
6. Run a real Stripe test transaction end-to-end

**Rollback if needed:** `git reset --hard vanilla-js-baseline`
