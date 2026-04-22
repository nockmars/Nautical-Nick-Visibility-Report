# Claude Handoff — Nautical Nick Visibility Report

> Running context summary for whoever picks this up next (likely future-you after a `/clear`). Project: daily ocean visibility tracker for spearfishermen, 4 SoCal regions, scaling to US eventually. Repo: `nockmars/Nautical-Nick-Visibility-Report`.

---

## Deployment state

| Thing | Where | Notes |
|---|---|---|
| Repo | github.com/nockmars/Nautical-Nick-Visibility-Report | `main` is live |
| Backend | Railway (Hobby, $5/mo) | Nixpacks, healthcheck `/api/health`, port 8080 public |
| Frontend | Served by the same Express process | (Cloudflare Pages planned but not yet split) |
| DNS | `nauticalnick.net` (Cloudflare, unverified) | `api.nauticalnick.net` planned for split later |
| Daily data | GitHub Actions cron `30 15 * * *` (8:30 AM PDT) | `.github/workflows/daily-update.yml` |
| Payments | Stripe (switched from LemonSqueezy) | $4.99/mo subscription. `automatic_tax: true`. Business entity = Relay. |
| Email | Resend | `alerts@nauticalnick.net` (domain verified in Resend — confirm) |

### Railway env vars (set in Variables tab)
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `FROM_EMAIL`, `BASE_URL`
- `NASA_EARTHDATA_USER`, `NASA_EARTHDATA_PASS`
- `NODE_ENV=production` (recommended)
- `DATA_DIR=/data` ← **NOT YET SET.** Needed with a mounted Volume or users.json wipes on deploy.
- `CORS_ORIGIN` — only if frontend goes to a different origin later.

### GitHub Actions secrets (repo → Settings → Secrets → Actions)
Same-named as Railway, for the daily-update workflow:
- `NASA_EARTHDATA_USER`, `NASA_EARTHDATA_PASS`
- `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `BASE_URL`
- User needs to verify all of these are set — last status unclear.

### Stripe webhook events wired
- `checkout.session.completed`
- `customer.subscription.created` / `updated` / `deleted`
- `invoice.payment_succeeded` / `payment_failed`

Endpoint URL: `{BASE_URL}/api/stripe-webhook` (raw body middleware is in place).

---

## Shipped so far

### Phase 1 — data pipeline (commit `d3c25ec`)
- `scripts/fetch-satellite.js` — 3-source chlorophyll chain: NOAA CoastWatch MODIS → NOAA West Coast VIIRS → NASA OceanColor (Earthdata auth). Falls back to yesterday's reading + `stale: true` flag.
- `scripts/fetch-weather.js` — Open-Meteo weather + 5-day rain history per spot.
- `scripts/compute-visibility.js` — reconciliation algorithm:
  - Baseline: `vis_ft = clamp(30 - 20*log10(chl/0.3), 3, 40)`
  - Swell penalty tiers, wind penalty tiers, rain penalty with location-type multiplier (harbor/bay = 2x recovery, cove = 1.5x)
  - Outputs `visibility`, `visibilityRange {low, high}`, `visibilityConfidence` (high/medium/low), `visibilityFactors[]` with `{label, direction, severity}`
- Frontend: green/amber/red vis tier colors with glow, factor chips on cards, stale banner, Ocean Oracle Pro rebrand.

### Phase 2a — server-verified subscriptions (commit `eea7aad`)
Killed the leaky localStorage paywall. Added cookie sessions + `/api/me` as canonical truth. (This was the magic-link version — the user switched to passwords next.)

### Phase 2b — password accounts + partial paywall (commit `a867836`) ← LATEST
- **Scrapped magic link.** Now username+password.
- `api/db.js` — JSON-backed user/session store. Writes to `data-runtime/users.json` atomically. scrypt password hashing (`N=2^14, r=8, p=1`).
- `api/auth.js` — `POST /api/auth/register`, `POST /api/auth/login` (identifier = username OR email), `POST /api/auth/logout`, `GET /api/me`. Failed logins burn equal scrypt cycles (timing-constant).
- **Spot modal — partial paywall.**
  - Free: name, type/depth/coords, beach photo (reads `details.imageUrl` or `spotMeta.imageUrl`; falls back to "🌊 Photo coming soon"), OpenStreetMap embed, visibility number + range + confidence, plain-English reasoning descriptor ("Based on: Clean water · Light swell · No recent rain" — built from factor labels, no raw numbers leaked).
  - Gated: chlorophyll/swell/wind/5-day-rain tiles, factor chips, spearfishing rating, seasonal fish, hunting tips, 14-day predictions. Blurred with a "Subscribe to Ocean Oracle Pro" pill when locked.

---

## File map (what lives where)

```
api/
  server.js    Express app, Stripe checkout + webhook, alerts, static serving, CORS
  auth.js      register/login/logout/me router + requireAuth middleware
  db.js        JSON store: users, sessions; scrypt hashing; isPro() helper

scripts/
  fetch-satellite.js   Multi-source chlorophyll with Earthdata fallback
  fetch-surf.js        Swell + wind (Open-Meteo Marine)
  fetch-weather.js     Weather + 5-day rain history (Open-Meteo)
  scrape-justgetwet.js San Diego ground truth (continue-on-error)
  compute-visibility.js  Reconciliation algorithm → vis_ft + range + confidence + factors
  generate-summary.js    Anthropic-powered daily region summaries
  send-alerts.js         Resend alert emails
  update-all.js          Orchestrator (used locally; GH Actions calls steps individually)

data/
  regions.json     Static region + spot definitions (coords, maxDepth, type)
  conditions.json  Updated daily by the pipeline; holds per-spot readings
  history.json     Trailing visibility history per region
  spot-details.json  Premium content (spearing rating, seasonal fish, tips, etc.)
  alerts.json      Saved email alert registrations
  snapshots.json   Scripps pier cam snapshots (SD only)

data-runtime/      ← gitignored; holds users.json at runtime
                   ← on Railway, mount Volume at $DATA_DIR (set DATA_DIR=/data)

.github/workflows/daily-update.yml   Cron + all the fetch/compute/alert steps

js/app.js          One-file frontend: DATA + STATE caches, all render fns,
                   auth handlers, spot modal. apiFetch() always sends
                   credentials so cookies flow.

css/style.css      Single stylesheet. Notable sections: vis tier colors,
                   factor chips, auth tabs, spot-hero-media, spot-gated-tiles.

index.html         Single-page app. Subscribe modal = "Ocean Oracle Pro".
                   Login modal has two tabs. Spot modal has free hero +
                   gated tile grid.
```

---

## Known gotchas / follow-ups

### Must-do before real users
1. **Railway Volume.** Mount at `/data`, set `DATA_DIR=/data`. Otherwise every redeploy wipes accounts and sessions.
2. **Verify GitHub Actions secrets** (all listed above). Manually trigger the workflow once: Actions → Daily Data Update → Run workflow → main.
3. **Test end-to-end Stripe flow** with card `4242 4242 4242 4242`. Expected: sign in, click Subscribe, land on Stripe, complete checkout, redirect back, gated tiles unlock within ~10s (frontend polls `/api/me` after `?stripe_success=1`).

### Nice-to-have
- **Beach photos.** Currently every spot shows the fallback. Add `imageUrl` per spot in `data/regions.json` or `data/spot-details.json`.
- **Bug to check:** `js/app.js` line ~508 references `f.impact` but compute-visibility.js writes `f.direction`. Factor chips on public spot cards may not be color-coding correctly. Trivial fix, just renaming one.
- **Bug to check:** `applyAuthUi()` doesn't refresh an open spot modal's lock state. Edge case — user signs in while spot modal is already open. Low priority. Fix by re-toggling `#spotGatedTiles.locked` in `applyAuthUi()`.

### Architectural decisions explicitly made (don't revisit without cause)
- **JSON file DB** over SQLite/Postgres. Fits MVP scale (<few thousand users), zero deps, no native modules, one file to back up. Migrate when it hurts, not before.
- **scrypt** over bcrypt/bcryptjs. Built into Node, memory-hard, zero dep.
- **Stripe** over LemonSqueezy. 2.9%+$0.30 vs 5%+$0.50; Stripe Tax handles CA sales tax; Stripe acquired LS July 2024.
- **Railway** over Render/Vercel. User was fine paying $5/mo for an always-warm Express process (Render cold starts, Vercel serverless awkward for webhook + long-polling).
- **OpenStreetMap embed iframe** over static map APIs. No key, free forever, works.

---

## Roadmap (user's priority order, as of last conversation)

Scrapped: comments/feedback feature (user explicitly said to scrap it).

**Next up candidates** (user to pick):
- Water quality / HAB scraping for OC, LA, Catalina (parity with SD's JustGetWet)
- Server-verified alert subscriptions tied to user accounts (alert form uses signed-in email)
- Stream gauge runoff proxies (improves rain penalty near river mouths, Phase 3 territory)
- NASA PACE hyperspectral upgrade (Phase 3)
- Nationwide expansion (Phase 4)

---

## Conventions to keep

- `apiFetch(path, opts)` in `js/app.js` centralizes fetch and always sends `credentials: 'include'`. Don't bypass it for API calls or cookies stop working cross-origin.
- `STATE.me` is the single source of truth for auth/Pro. `isSignedIn()` and `isSubscribed()` read from it.
- After any auth-state change, call `refreshMe()` then `applyAuthUi()`.
- Never reintroduce localStorage-based paywall bypass. Server is the source of truth.
- Stripe webhooks use `stripe_customer_id` to find the user row (not email — user might change it). `client_reference_id` on checkout = user.id.
- All scripts in `scripts/` must be safe to run standalone (use `continue-on-error` semantics in CI).

---

## Credentials reminder

The user has handed over real secrets (NASA Earthdata password, Stripe keys) in past conversations. Do NOT store these in any file. They go in Railway Variables and GitHub Secrets only. Don't ask the user to re-paste them unless something is actually broken.

---

_Last updated: 2026-04-21 by Claude session at commit `a867836`._
