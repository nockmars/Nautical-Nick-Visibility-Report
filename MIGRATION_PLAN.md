# Migration Plan — Vanilla JS + Express → Next.js 15 App Router + Postgres

> **Status: APPROVED — Decisions Locked 2026-04-22**

**TL;DR.** We move the live site (`index.html` + `js/app.js` + `api/server.js` + JSON files in `data-runtime/`) onto Next.js 15 App Router with TypeScript, served by the same Railway service, backed by a Railway Postgres database accessed through Prisma. The vanilla stack stays running on `main` until the new stack reaches functional parity with `MIGRATION_BASELINE.md`. Cutover is a single Railway deploy that swaps the start command; rollback is `git reset --hard vanilla-js-baseline` plus a Railway redeploy. Two bugs on `main` are fixed first (Pre-Phase-0). Then six phases over an estimated 5–8 working sessions: Phase 0 infra prep, Phase 1 schema + auth, Phase 2 data pipeline + cron, Phase 3 forecast + alerts, Phase 4 UI port + Tailwind, Phase 5 cutover, Phase 6 cleanup.

---

## 1. Goals & Non-Goals

### Goals
- **Functional parity with `MIGRATION_BASELINE.md`.** Every checkbox in that document must tick on the new stack before cutover.
- **Postgres replaces JSON file storage** for mutable user/session/subscription/alert data. Static reference data (`regions.json`, `spot-details.json`) is seeded into Postgres `locations` and `location_details` tables; the JSON files become the seed source of truth checked into the repo.
- **One Railway service** hosts both UI and API (Next.js Route Handlers). No split frontend/backend deployment in this migration.
- **TypeScript strict mode** across new code. No `any` without comment.
- **Server components by default.** Client components only where interactivity needs them (modal, region switcher, login form, Chart.js chart, paywall toggling).
- **Same domain (`nauticalnick.net`).** No DNS swap during cutover. Stripe webhook URL stays at `{BASE_URL}/api/stripe-webhook`.
- **No outage > 5 minutes** during cutover. Vanilla `main` keeps serving until the new build is verified on a Railway preview environment.

### Non-Goals (explicitly out of scope for this migration)
- **No new product features.** No water-quality scrapers for OC/LA, no PACE upgrade, no nationwide expansion. Roadmap items in `CLAUDE_HANDOFF.md` lines 132–141 wait until after cutover.
- **No comments/feedback feature.** Already rejected (baseline §"Explicitly rejected").
- **No SMS alerts.** Already rejected.
- **No magic-link auth re-introduction.** Username/password stays.
- **No client-side localStorage paywall.** Already rejected.
- **Tailwind is used — port happens in Phase 4.** `css/style.css` (1,920 lines) is ported to Tailwind during Phase 4. Exception: components with complex animations or elaborate custom CSS may stay as CSS modules — Frontend uses judgment per component. All new components must use Tailwind from day one.
- **No Cloudflare Pages split.** Frontend stays on Railway with the API; the planned `api.nauticalnick.net` subdomain split is not part of this migration.
- **No SQLite intermediate.** We go directly from JSON files → Postgres.

---

## 2. Target Architecture

### 2.1 Next.js App Router layout

```
app/
  layout.tsx                  Root layout, fonts (Bebas Neue, Russo One, Exo 2)
  page.tsx                    The single-page experience (server component shell)
  globals.css                 @tailwind directives + brand token overrides
  (marketing)/
    about/page.tsx            About section (currently inline in index.html)
  api/
    health/route.ts           GET  → {status:'ok', ts}
    me/route.ts               GET  → auth + subscription state (was /api/me)
    auth/
      register/route.ts       POST {username, email, password}
      login/route.ts          POST {identifier, password}
      logout/route.ts         POST clears cookie
    create-checkout-session/route.ts   POST → {url}
    stripe-webhook/route.ts            POST raw-body, signature verified
    alerts/
      set/route.ts                     POST {email, threshold, region}
    regions/route.ts                   GET → static region+spot data (was data/regions.json)
    conditions/route.ts                GET → today's conditions per region
    history/route.ts                   GET → 14-day rolling history
    snapshots/route.ts                 GET → pier cam metadata + image URLs
    spot/[id]/route.ts                 GET → spot detail (free fields always; gated fields when isPro)
components/
  RegionSelector.tsx          Client — was renderRegionSelector() in app.js
  ConditionsPanel.tsx         Server — today's conditions tile grid
  AIDailySummary.tsx          Server — reads forecasts table
  PierCamGallery.tsx          Server — 3 snapshots with Claude Vision piling labels
  SpotGrid.tsx                Server — 17 SD spots with vis bars / chips
  SpotModal.tsx               Client — modal, free hero + gated tiles
  HistoryChart.tsx            Client — Chart.js wrapper
  AccountChip.tsx             Client — header auth state
  LoginModal.tsx              Client — two-tab signup/login
  SubscribeButton.tsx         Client — Stripe Checkout redirect + ?stripe_success= polling
  AlertsForm.tsx              Client — Pro-only alert subscription
  PaywallGate.tsx             Server helper — wraps gated content
hooks/
  useAuth.ts                  Reads /api/me, exposes {authenticated, pro}
  useRegion.ts                Reads/writes localStorage REGION_KEY
lib/
  client/                     Browser-only utilities (apiFetch wrapper)
  db/
    client.ts                 Prisma client singleton
  auth/
    server.ts                 getSession(), requireAuth(), isPro()
    password.ts               scrypt hash + timing-safe compare
    cookies.ts                naut_session cookie helpers
  stripe/
    client.ts                 Stripe SDK singleton
    webhook.ts                signature verify + event handlers
  email/
    resend.ts                 Resend client
    templates/                alert-confirmation.tsx, alert-fired.tsx
  data/                       Ocean Data shared utilities + types
  forecast/                   Visibility Reporter — algorithm + cache lookup
  alerts/                     Visibility Reporter — threshold matching
  ai/                         Visibility Reporter — Claude API wrappers, prompt templates
prisma/
  schema.prisma
  migrations/
  seed.ts                     Seeds locations + location_details from data/regions.json
                              and data/spot-details.json
scripts/
  fetchers/
    fetch-satellite.ts        was scripts/fetch-satellite.js
    fetch-surf.ts             was scripts/fetch-surf.js
    fetch-weather.ts          was scripts/fetch-weather.js
  scrapers/
    scrape-justgetwet.ts      was scripts/scrape-justgetwet.js
  captures/
    capture-pier-cam.ts       was scripts/capture-pier-cam.js (Puppeteer + Claude Vision)
  forecast/
    compute-visibility.ts     was scripts/compute-visibility.js (moved to lib/forecast/)
                              entrypoint stays in scripts/forecast/
    generate-summary.ts       was scripts/generate-summary.js (Claude text synthesis)
  alerts/
    send-alerts.ts            was scripts/send-alerts.js
  migrate.ts                  Backend-only — wraps prisma migrate
  seed.ts                     Backend-only — wraps prisma db seed
  update-all.ts               Orchestrator (used locally + by daily-update.yml)
public/
  profile.jpg                 from assets/profile.jpg (consider compressing — currently 2.5MB)
middleware.ts                 Optional — auth refresh, no per-request Claude calls
.github/workflows/            (unchanged paths)
  daily-update.yml            Updated to run `npm run update` against new scripts
  capture-7am.yml             Updated entrypoint
  capture-9am.yml
  capture-12pm.yml
railway.json                  Updated startCommand: `npm start` → `next start`, build adds `prisma generate && next build`
next.config.mjs               Image config, raw body for webhook route
tailwind.config.ts            content: app/**+components/**, brand color tokens from css/style.css
postcss.config.mjs            Standard Tailwind v4 config
.env.example                  Adds DATABASE_URL; removes DATA_DIR
```

### 2.2 Postgres schema (per `CLAUDE.md` agent ownership)

**Backend-owned tables**
- `users` (id uuid pk, username citext unique, email citext unique, password_hash text, created_at, updated_at, stripe_customer_id text null, subscription_status text null, subscription_current_period_end timestamptz null)
- `sessions` (id text pk [64-byte hex], user_id uuid fk users on delete cascade, created_at, expires_at, indexed on user_id)
- `subscriptions` (id uuid pk, user_id uuid fk, stripe_subscription_id text unique, status, current_period_end, created_at, updated_at) — split out from `users` so we have history; `users.subscription_*` cols become a denormalized fast-read cache populated by webhook
- `password_resets` (id, user_id, token_hash, expires_at, used_at) — built but unused on day one; reserved for forgot-password
- `email_verifications` (same shape) — reserved
- `user_preferences` (user_id pk, default_region, notification_opt_in)
- `locations` (id text pk [stable slug, e.g. `sd-la-jolla-cove`], region text, name, latitude, longitude, max_depth_ft, type [harbor/bay/cove/coastal], is_premium_content_available bool, created_at)
- `location_details` (location_id pk fk, image_url, spearing_rating, seasonal_fish jsonb, hunting_tips jsonb, prediction_14d jsonb) — premium content from `data/spot-details.json`

**Ocean Data-owned tables** (raw signals, append-only)
- `chlorophyll_data` (id, location_id, fetched_at, source [`noaa-coastwatch`/`noaa-westcoast`/`nasa-oceancolor`/`cached`], value_mg_m3, stale bool, raw jsonb)
- `swell_data` (id, location_id, fetched_at, wave_height_ft, period_s, direction_deg, source, stale bool)
- `weather_data` (id, location_id, fetched_at, wind_mph, wind_dir, temp_f, source, stale bool)
- `tide_data` (id, location_id, fetched_at, tide_ft, source, stale bool) — table reserved; not yet wired (no current fetcher)
- `satellite_data` (id, location_id, fetched_at, image_url, metadata jsonb, source, stale bool) — distinct from chlorophyll_data; pier-cam-style image refs
- `conditions` (id, location_id, computed_at, rain_5d_in, source jsonb summary) — current `data/conditions.json` per-spot signal bundle, computed once per pipeline run

**Visibility Reporter-owned tables**
- `forecasts` (id, location_id, generated_at, visibility_ft, range_low_ft, range_high_ft, confidence [`high`/`medium`/`low`], factors jsonb [{label, direction, severity, reasoning}], summary_text text, summary_model text, primary key effectively (location_id, generated_at), index on (location_id, generated_at desc))
- `forecast_cache` (key text pk, payload jsonb, expires_at) — generic cache for AI summaries already keyed by region+date
- `alerts` (id uuid pk, email citext, user_id uuid null fk, region text, threshold_ft int, created_at, last_sent_date date null, active bool default true, unique on (email, region))
- `prediction_logs` (id, location_id, generated_at, input_snapshot jsonb, output_snapshot jsonb, claude_model, claude_tokens_in, claude_tokens_out) — observability; also our backstop if we ever need to retune

**Pier cam snapshots**
- Image files stay on disk (Railway persistent volume mounted at `/data/snapshots/`) for now. The `satellite_data` table holds the image_url and Claude Vision piling labels. Migrating to S3/R2 is out of scope.

### 2.3 Deployment topology (Railway)

- **One service** (`nautical-nick-web`): Next.js 15 (Node runtime), `next start` on `$PORT`. Healthcheck `/api/health`.
- **One database**: Railway-managed Postgres add-on. `DATABASE_URL` injected.
- **One persistent volume**: mounted at `/data/snapshots` (down from full `/data`). Holds pier cam JPGs only. `users.json` no longer needed → eliminates the day-one risk of unmounted-volume account wipe.
- **GitHub Actions** still own the cron: `daily-update.yml` runs `npm run update` which now connects to Railway Postgres via `DATABASE_URL` (added to Actions secrets).

### 2.4 Env var changes

| Var | Status | Notes |
|---|---|---|
| `DATABASE_URL` | **NEW** | Railway Postgres + GH Actions secret |
| `DATA_DIR` | **REMOVED** | Replaced by Postgres + `/data/snapshots` mount path baked into config |
| `ANTHROPIC_API_KEY` | unchanged | now also called from `lib/forecast/` cron entrypoints |
| `STRIPE_SECRET_KEY` | unchanged | live key in Railway production only; test key in Railway preview only |
| `STRIPE_PRICE_ID_MONTHLY` | **RENAMED** | was `STRIPE_PRICE_ID`; test-mode value in preview, live in production |
| `STRIPE_PRICE_ID_ANNUAL` | **NEW** | test-mode value in preview, live in production |
| `STRIPE_WEBHOOK_SECRET` | unchanged | separate test-mode value for preview env |
| `RESEND_API_KEY`, `FROM_EMAIL`, `BASE_URL` | unchanged | |
| `NASA_EARTHDATA_USER`, `NASA_EARTHDATA_PASS` | unchanged | GH Actions only |
| `NODE_ENV`, `PORT` | unchanged | |
| `CORS_ORIGIN` | unchanged | still optional |
| `SESSION_COOKIE_NAME` | **NEW (optional)** | defaults to `naut_session` |

---

## 3. Phased Plan

Each phase ships to a long-lived branch `migration/next` (NOT `main`). `main` keeps serving the vanilla stack until Phase 5 cutover. The vanilla code is preserved at the existing `vanilla-js-baseline` tag.

### Pre-Phase-0 — Bug Fixes on `main` (do BEFORE creating `migration/next`)

**Owner:** Frontend agent. Ship via `/ship` skill. Cherry-pick into `migration/next` once that branch exists.

**Bug 1 — `f.impact` undefined** (`js/app.js` lines 496 and 721): Both `renderSpotGrid` (line 496) and `renderFactorChips` (line 721) set `chip.className` using `f.impact`, but `compute-visibility.js` writes the field as `f.direction`. The undefined access silently renders a broken CSS class, breaking factor chip color-coding on spot cards. Fix: replace `f.impact` with `f.direction` (with null-guard: `f.direction || ''`) at both sites.

**Bug 2 — `applyAuthUi()` modal lock not cleared** (`js/app.js` line 160): `applyAuthUi()` updates body classes and the account chip but does NOT re-evaluate the open spot modal's lock state. When a user signs in while a spot modal is open, `gatedTiles` and `premiumWrap` keep the `.locked` class because `openSpotModal()` (which applies lock state at lines 564 and 604–609) is not re-called. Fix: in `applyAuthUi()`, detect whether `spotModal` is currently visible and if so call `openSpotModal(currentOpenSlug)` to re-render with the updated auth state. Track the current open slug in a module-level variable (e.g., `STATE.openSpotSlug`).

Record commit SHAs here after shipping: `BUG_FIX_SHA_1 = ___`, `BUG_FIX_SHA_2 = ___`

---

### Phase 0 — Infra Prep (no user-facing change)

**Owner:** Backend (infra, config, Prisma skeleton) + Frontend (App Router skeleton).
**Goal:** `migration/next` branch boots a Hello World Next.js page at the Railway preview URL. No feature parity needed.

See §8 for the full step-by-step Phase 0 breakdown.

**Exit criteria:**
- `migration/next` branch pushed to origin.
- Railway preview environment builds without error.
- Preview URL returns 200 and renders "Migration in Progress".
- A Tailwind class renders visibly in the placeholder page.
- `npx prisma generate` completes without error.
- `npx prisma db push` connects to preview Postgres without error.
- No TypeScript errors: `npx tsc --noEmit` passes.
- `main` deploy is unchanged, vanilla site still live.

**Rollback:** Delete the Railway Postgres add-on, delete the preview environment, delete the branch. Zero impact to production.

---

### Phase 1 — Schema + auth + paywall server logic

**Owner:** Backend.
**Scope:**
- Implement `lib/auth/server.ts`, `lib/auth/password.ts`, `lib/auth/cookies.ts`. Cookie name stays `naut_session`.
- Implement `app/api/auth/register/route.ts`, `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/api/me/route.ts`. Behavior must match `api/auth.js` byte-for-byte from the user's perspective (same body shapes, same generic-failure messages, same cookie attrs, same scrypt KDF parameters `N=2^14, r=8, p=1`).
- Implement `lib/stripe/client.ts`, `lib/stripe/webhook.ts`, `app/api/create-checkout-session/route.ts`, `app/api/stripe-webhook/route.ts` (raw body via `next.config.mjs` API route config; still called at `/api/stripe-webhook` so the dashboard URL stays valid).
- **Stripe test-mode task:** Backend sets `STRIPE_SECRET_KEY` (test mode), `STRIPE_PRICE_ID_MONTHLY` (test mode), `STRIPE_PRICE_ID_ANNUAL` (test mode), and `STRIPE_WEBHOOK_SECRET` (test mode) in the Railway preview environment. Live keys stay in Railway production env only. Never mix modes between environments.
- Implement `isPro(user)` paywall helper used by all gated routes.
- Force re-login at cutover: no session migration code needed. **Do not** port session rows from `users.json` into Postgres. Users will be logged out on cutover day; the user will email existing accounts a heads-up before cutover — this is a user action, not a migration task.
- Tests REQUIRED: webhook signature verification, each event handler, login success/failure timing, session lifecycle, `isPro()` logic, every gated route returns 403 for free users.

**Exit criteria:**
- All auth endpoints reachable on the preview URL.
- `4242 4242 4242 4242` test card on the preview Stripe webhook URL drives `users.subscription_status='active'` in preview Postgres.

**Rollback:** Drop and recreate `users`/`sessions`/`subscriptions` tables. Vanilla `main` is unaffected (it still reads `users.json`).

---

### Phase 2 — Data pipeline on Postgres

**Owner:** Ocean Data (with Backend cron + secret help).
**Scope:**
- Port `scripts/fetch-satellite.js` → `scripts/fetchers/fetch-satellite.ts`. Writes to `chlorophyll_data` instead of `data/conditions.json`. Preserve the full 3-source fallback chain (NOAA CoastWatch → NOAA West Coast → NASA Earthdata → cached + `stale: true`).
- Port `scripts/fetch-surf.js` → `scripts/fetchers/fetch-surf.ts`. Writes to `swell_data`.
- Port `scripts/fetch-weather.js` → `scripts/fetchers/fetch-weather.ts`. Writes to `weather_data` and feeds `conditions.rain_5d_in`.
- Port `scripts/scrape-justgetwet.js` → `scripts/scrapers/scrape-justgetwet.ts`. Continues to be SD-only, graceful failure.
- Port `scripts/capture-pier-cam.js` → `scripts/captures/capture-pier-cam.ts`. Writes JPG to `/data/snapshots/`, metadata + Claude Vision labels to `satellite_data`.
- Port `scripts/update-all.js` → `scripts/update-all.ts` (orchestrator).
- Backend updates `.github/workflows/daily-update.yml`, `capture-7am.yml`, `capture-9am.yml`, `capture-12pm.yml` to call the new TS entrypoints (via `tsx` or pre-compiled). Adds `DATABASE_URL` to the workflows.
- Ocean Data provides a `lib/data/history-reader.ts` utility that reads `data/history.json` — used by Visibility Reporter's backfill script in Phase 5.
- Tests REQUIRED: parser functions, fallback chain behavior, every fetcher writes to its table with `source` and `stale` set.

**Exit criteria:**
- One full pipeline run on the preview environment populates `chlorophyll_data`, `swell_data`, `weather_data`, `conditions`, `satellite_data` for all 17 SD spots.
- Manually triggered GH Actions run against the preview branch succeeds end-to-end.
- Output is semantically equivalent to vanilla `data/conditions.json` from the same day.

**Rollback:** Vanilla cron still writes to JSON files on `main`. The new pipeline writing to Postgres on `migration/next` doesn't touch live state.

---

### Phase 3 — Forecast + alerts

**Owner:** Visibility Reporter (Backend exposes API routes).
**Scope:**
- Move the algorithm from `scripts/compute-visibility.js` into `lib/forecast/compute-visibility.ts`. Document any coefficient changes with date-stamped comments.
- Cron entrypoint `scripts/forecast/generate-forecasts.ts` reads from `chlorophyll_data` + `swell_data` + `weather_data` + `conditions`, calls `computeVisibility()`, writes a row per spot to `forecasts`.
- Move `scripts/generate-summary.js` into `lib/ai/summary.ts` + `scripts/forecast/generate-summary.ts`. Continues to use `@anthropic-ai/sdk`. Adds prompt caching. Writes `summary_text` + `summary_model` to `forecasts` for that day, plus an entry in `forecast_cache` keyed by region+date.
- Move `scripts/send-alerts.js` into `scripts/alerts/send-alerts.ts`. Reads from `forecasts` + `alerts` tables. Per-email-per-region-per-day enforcement via `alerts.last_sent_date`.
- Backend exposes `GET /api/conditions`, `GET /api/history`, `GET /api/snapshots`, `GET /api/regions`, `GET /api/spot/[id]` reading from Postgres with paywall gating.
- **Caching contract:** these routes do NOT call the Claude API. They only read. CI test asserts no `@anthropic-ai/sdk` import in `app/api/**`.
- Tests REQUIRED: `computeVisibility()` deterministic input → expected output, each penalty function with edge cases, alert threshold matching, cache lookup returns DB row not Claude call, gated routes return 403 + free-only fields.

**Exit criteria:**
- Cron-driven `forecasts` table has one row per spot per day on the preview environment.
- Hitting `GET /api/spot/sd-la-jolla-cove` as anonymous returns hero fields only; same request with a Pro session cookie returns full payload.
- `npm run alerts` against the preview environment sends a test email via Resend.

**Rollback:** Branch-only.

---

### Phase 4 — UI port + Tailwind

**Owner:** Frontend.
**Scope:**
- Port `index.html` (576 lines) into `app/layout.tsx` + `app/page.tsx` + components in §2.1.
- Port `js/app.js` (1,109 lines) into typed React components. The `STATE` and `DATA` global caches in app.js become server-component fetches plus a small `useAuth` hook.
- **Port `css/style.css` (1,920 lines) to Tailwind.** Utility classes for layout, spacing, typography. Brand color tokens (`--bg: #0a2a3a`, `--panel: #0d3347`, `--cyan: #4ad8f5`, `--orange: #ff7a2f`) are registered in `tailwind.config.ts` as custom colors. Exception: components with complex animations or elaborate custom CSS (e.g., the grid overlay, radial vignette, vis-bar animation) may stay as CSS modules — Frontend uses judgment per component.
- All new components use Tailwind. No inline `style.css` classes on new code.
- Implement `RegionSelector` (client, persists to localStorage `REGION_KEY`).
- Implement `SpotModal` with the free hero / gated tile pattern from `js/app.js`. The two known bugs are already fixed on `main` (Pre-Phase-0) and cherry-picked into this branch — the React component inherits the corrected behavior by design (state subscription handles auth changes naturally).
- Implement Stripe redirect handler: page reads `?stripe_success=1&session_id=...`, polls `/api/me` ~6× to detect the unlock, shows a toast.
- Implement `AlertsForm` — Pro-only, posts to `/api/alerts/set`.
- Mobile (375px) and desktop (1280px) screenshots via `mcp__Claude_Preview__preview_screenshot` for every component, both free and Pro views for paywall components.
- Tests REQUIRED: paywall display logic (free vs Pro), auth UI flows, modal lock behavior on auth state change.

**Exit criteria:**
- Preview URL renders the full SD region with all 17 spots.
- Side-by-side screenshots vs vanilla site show no visual regression on the listed panels.
- All 17 SD spots' modals open free and gated correctly with a real test Pro account.

**Rollback:** Branch-only.

---

### Phase 5 — Cutover

**Owner:** Backend (orchestrates), Frontend (verification), Project Manager (sign-off).

**Entry criteria — ALL three must be true before cutover begins:**
- [ ] User is well-rested and has at minimum 4 uninterrupted hours available
- [ ] `migration/next` branch has passed ALL verification tests against the Railway preview environment
- [ ] No late-night, pre-meeting, or pre-travel cutovers — user must confirm timing explicitly

**Scope:**
1. Run the entire `MIGRATION_BASELINE.md` checklist on the preview URL. Every box ticks or has a documented exception.
2. **Freeze writes** on the vanilla site (announce a 5-minute maintenance window).
3. **Backfill 14-day history:** Visibility Reporter runs the backfill script (see §4 and §8 for details) that synthesizes `forecasts` rows from `data/history.json`, so the chart is full from cutover day one. Ocean Data's `lib/data/history-reader.ts` provides the reader utility.
4. Update Railway start command from `node api/server.js` → `next start` (via `railway.json`).
5. Update `railway.json` build command to include `prisma generate && next build`.
6. Push `migration/next` → `main` (fast-forward merge with a single squash commit `feat: cut over to Next.js 15 + Postgres`).
7. Watch Railway deploy. Healthcheck passes → cutover live.
8. Smoke test on production: log in, load SD region, open a spot modal, run a Stripe `4242` test transaction, verify the unlock, log out, log back in.
9. Tag the cutover commit `v2.0.0-nextjs`.

**Risk note — re-login at cutover:** Sessions are NOT migrated. All existing logged-in users will be logged out. The user will email existing accounts a heads-up before cutover. This is a user action, not a migration task.

**Exit criteria:**
- Production at `nauticalnick.net` runs the new stack.
- A new Stripe test transaction completes and unlocks Pro tiles.
- One successful daily cron run completes after cutover and writes to Postgres.

**Rollback (if anything fails):**
- `git reset --hard vanilla-js-baseline` and force-push `main` (user explicitly approves — this is the documented exception to the no-force-push rule).
- Trigger Railway redeploy of `main`.
- Total expected rollback time: under 10 minutes.
- The Postgres add-on stays provisioned (no data loss; vanilla just doesn't read it).

---

### Phase 6 — Cleanup (post-cutover, T+24h to T+7d)

**Owner:** Backend.
**Scope:**
- After 24h of clean Postgres operation, delete `data-runtime/users.json` from the production Railway volume.
- Delete `api/server.js`, `api/auth.js`, `api/db.js`, `js/app.js`, `index.html`, `css/style.css`, the original `scripts/*.js` files (they live at the `vanilla-js-baseline` tag if needed).
- Move `data/regions.json` and `data/spot-details.json` into `prisma/seed-data/`.
- Optional: shrink the Railway volume from `/data` to `/data/snapshots` once we're sure nothing else writes there.
- Update `CLAUDE.md` to remove the "mid-migration" note.
- Update `README.md` to reflect the new stack.
- Open follow-up issues for: Cloudflare Pages frontend split, S3/R2 for pier cam images, water-quality scrapers for OC/LA.

**Exit criteria:**
- Repo no longer contains the vanilla files.
- `CLAUDE.md` is current.

**Rollback:** Restore deleted files from `vanilla-js-baseline` tag if needed. Postgres data persists regardless.

---

## 4. Per-Agent Work Breakdown

### Backend
- **Pre-Phase-0:** cherry-pick bug-fix commits from `main` into `migration/next` once the branch exists.
- **Phase 0:** create `migration/next` branch; provision Railway Postgres addon + preview env; install packages; create `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`; create `prisma/schema.prisma` stub; run `prisma db push`; update `.env.example`.
- **Phase 1:** port `api/auth.js` → `lib/auth/server.ts` + `app/api/auth/*/route.ts`; port `api/db.js` user/session JSON store → Prisma queries; port `api/server.js` Stripe handlers → `lib/stripe/*` + `app/api/stripe-webhook/route.ts` + `app/api/create-checkout-session/route.ts`; set test-mode Stripe env vars in Railway preview.
- **Phase 2:** update `.github/workflows/daily-update.yml` + the three `capture-*.yml` files to invoke new TS entrypoints; add `DATABASE_URL` to GH Actions secrets.
- **Phase 3:** expose API routes reading from Postgres with paywall gating; CI guard "no `@anthropic-ai/sdk` in `app/api/**`".
- **Phase 5:** update `railway.json` start + build commands; orchestrate cutover.
- **Phase 6:** clean up vanilla files, shrink volume mount, update `CLAUDE.md`.

**Files inherited from vanilla:** `api/server.js`, `api/auth.js`, `api/db.js`, `railway.json`, `.github/workflows/*.yml`, `package.json`, `.env.example`.

### Frontend
- **Pre-Phase-0:** own both bug fixes on `main`. Ship via `/ship` skill.
- **Phase 0:** create `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (the skeleton). Coordinate with Backend on brand color tokens for `tailwind.config.ts`.
- **Phase 4:** entire UI port + Tailwind migration. Owns `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, every `components/*.tsx`, every `hooks/*.ts`, `lib/client/*`, `public/profile.jpg`. Visual verification via Claude Preview tools at mobile + desktop, free + Pro.
- **Phase 5:** verification — runs the full UI checklist of `MIGRATION_BASELINE.md` on the preview URL before cutover.

**Files inherited from vanilla:** `index.html` (576 lines), `js/app.js` (1,109 lines), `css/style.css` (1,920 lines), `assets/profile.jpg`.

### Ocean Data
- **Phase 2:** entire pipeline port. Owns `scripts/fetchers/fetch-satellite.ts`, `scripts/fetchers/fetch-surf.ts`, `scripts/fetchers/fetch-weather.ts`, `scripts/scrapers/scrape-justgetwet.ts`, `scripts/captures/capture-pier-cam.ts`, `scripts/update-all.ts`, `lib/data/types.ts`. Also provides `lib/data/history-reader.ts` for use by Visibility Reporter's Phase 5 backfill.
- **Phase 5:** verifies one full pipeline run on the preview environment immediately before cutover.

**Files inherited from vanilla:** `scripts/fetch-satellite.js`, `scripts/fetch-surf.js`, `scripts/fetch-weather.js`, `scripts/scrape-justgetwet.js`, `scripts/capture-pier-cam.js`, `scripts/update-all.js`.

### Visibility Reporter
- **Phase 3:** owns `lib/forecast/compute-visibility.ts`, `lib/forecast/cache.ts`, `lib/ai/summary.ts`, `lib/ai/vision.ts`, `lib/alerts/threshold.ts`, `scripts/forecast/generate-forecasts.ts`, `scripts/forecast/generate-summary.ts`, `scripts/alerts/send-alerts.ts`.
- **Phase 5:** writes the 14-day history backfill script. Reads `data/history.json` via Ocean Data's `lib/data/history-reader.ts` utility, synthesizes one `forecasts` row per spot per day, inserts into Postgres. Runs on cutover day before the maintenance window ends. Also verifies the daily forecast cron run on cutover day.

**Files inherited from vanilla:** `scripts/compute-visibility.js`, `scripts/generate-summary.js`, `scripts/send-alerts.js`.

---

## 5. Risks & Mitigations

### Risk 1 — Stripe webhook URL change forces re-registration
**Likelihood:** Low. **Impact:** High (missed events = users pay but stay locked).
**Mitigation:** The webhook URL is `{BASE_URL}/api/stripe-webhook` and stays exactly that. The Next.js Route Handler at `app/api/stripe-webhook/route.ts` accepts raw body via `next.config.mjs`. Backend tests signature verification before cutover. The webhook handler is idempotent (keyed on Stripe event id) so a manual replay from the Stripe dashboard recovers any missed event.

### Risk 2 — Re-login at cutover
**Likelihood:** Certain (by design). **Impact:** Low (one re-login; no data loss).
**Mitigation:** Sessions are not migrated — force re-login is the chosen approach. User will email existing accounts a heads-up before cutover. This is a user action, not a migration task.

### Risk 3 — Cron secrets / `DATABASE_URL` rotation
**Likelihood:** Medium. **Impact:** High (silent pipeline failure = stale data on the site).
**Mitigation:** Backend adds `DATABASE_URL` to GH Actions secrets in Phase 0 against the preview Postgres. On cutover, the GH Actions workflow uses the production `DATABASE_URL`. Backend also adds a workflow step that fails loudly if the daily run completes without a fresh `forecasts` row per spot.

### Risk 4 — 14-day chart empty on cutover day
**Likelihood:** N/A (mitigated by design).
**Mitigation:** Decision #3: Visibility Reporter backfills `forecasts` rows from `data/history.json` in Phase 5, before go-live. Chart is full from day one.

### Risk 5 — SEO / URL change regression
**Likelihood:** Low. **Impact:** Low (single-page app, no deep URLs to preserve).
**Mitigation:** The app is genuinely single-route. The new Next.js app keeps `/` as the entrypoint. The only externally-known URL beyond `/` is `/api/stripe-webhook`, which is preserved.

### Risk 6 — Pier cam JPG storage path on Railway
**Likelihood:** Medium. **Impact:** Medium (broken hero images for ~hours until next capture).
**Mitigation:** Volume mount path moves from `/data` to `/data/snapshots`. The Phase 5 cutover keeps the existing `/data` mount intact and adds a `/data/snapshots` symlink so existing JPG paths resolve. Phase 6 cleanup retires the old mount only after a week of clean operation.

### Risk 7 — Tailwind visual regression during Phase 4
**Likelihood:** Medium. **Impact:** Medium (incorrect spacing, color drift, layout breaks).
**Mitigation:** Frontend runs side-by-side screenshot comparisons after every component port (`mcp__Claude_Preview__preview_screenshot`). Brand color tokens are imported from `css/style.css` comments into `tailwind.config.ts` before any component work begins. Components with complex animations stay as CSS modules until explicitly migrated.

---

## 6. Verification — mapping `MIGRATION_BASELINE.md` items to verification steps

| Baseline section | Verification approach |
|---|---|
| Public features (region dropdown, AI panel, conditions, pier cam, spot grid, modal, history chart, region persistence, About) | Frontend runs visual regression on preview URL: `mcp__Claude_Preview__preview_screenshot` mobile + desktop for each panel, side-by-side vs vanilla. Each item ticks only when screenshots match. |
| Auth (signup, login, logout, `/api/me`, cookie attrs, generic-failure, scrypt, account chip) | Backend integration tests cover server-side. Frontend Vitest + Testing Library covers UI flows. Manual: real signup + login + logout on the preview URL with a fresh browser profile. |
| Paywall (modal gating, alerts lock, factor chip detail, Pro detection logic) | Backend test asserts every `/api/spot/[id]` gated field is absent for free user, present for Pro user. Frontend test asserts gated tiles have `.locked` class and CTA pill for free users. Manual: log in as free user → see lock; upgrade via test card → see unlock. |
| Stripe Checkout (button gating, checkout session, redirect polling, webhook signature, event handlers, DB updates) | Backend tests cover signature verification + every event handler. Manual: end-to-end `4242 4242 4242 4242` flow on preview URL → confirm `subscription_status='active'` in preview Postgres → confirm UI unlocks within ~10s. |
| Email Alerts (set endpoint, daily cron, one-per-day enforcement) | Backend test asserts `POST /api/alerts/set` writes to `alerts` table + sends Resend confirmation (mock). Visibility Reporter test asserts `last_sent_date` enforcement. Manual: subscribe a real email, lower a real spot's threshold, manually run the alerts cron, verify one email arrives. |
| Frontend routes (`/`, fallback, no client router, Stripe redirect params) | Manual click-through on preview URL. |
| Backend routes (every endpoint listed in baseline §"Backend") | Integration test per route asserts HTTP method + path + auth requirement + response shape. CI fails if a route is missing. |
| External integrations (Anthropic, Stripe, Resend, NASA, NOAA, Open-Meteo, JustGetWet, Scripps, GH Actions, Railway, Cloudflare) | Each fetcher has a fallback-chain test (Ocean Data). Manual: trigger one full `daily-update.yml` run against the preview environment. |
| DB schema | Prisma migration produces tables that hold every field listed. Seed script populates `locations` + `location_details`. Backend asserts row counts. |
| Env vars | `.env.example` lists every var. Backend asserts process boots only when required vars are set. |
| NPM scripts | `package.json` provides `start`, `dev`, `capture`, `satellite`, `surf`, `scrape`, `summary`, `alerts`, `update`. Each tested by running once against the preview Postgres. |
| Known bugs | Both fixed in Pre-Phase-0 on `main`, cherry-picked into `migration/next`. Regression tests added. |
| NOT-yet-built items | CI lint check: no comment containing "TODO: PACE" or "TODO: SMS" left half-shipped. |
| Static assets | Frontend confirms `assets/profile.jpg` moves to `public/profile.jpg`, fonts load from CDN, Chart.js loads, SVG icons inline. |

**Final go/no-go:** Project Manager runs the full baseline checklist on the preview URL. The three Phase 5 entry-criteria boxes must all be checked before cutover proceeds.

---

## 7. Decisions Locked

All 8 open questions from the draft plan are resolved. No further discussion needed.

1. **ORM: Prisma.** Chosen for ecosystem maturity, generated client typing, user-friendly migration CLI, and strong AI training data coverage (fewer Claude mistakes).
2. **Tailwind: during migration, Phase 4.** Port `css/style.css` to Tailwind during Phase 4 rather than after. All new components use Tailwind from day one. Complex animations may stay as CSS modules per Frontend's judgment.
3. **Backfill 14-day history.** Visibility Reporter writes a backfill script in Phase 5; Ocean Data provides the `history-reader.ts` utility. Chart is full on cutover day one.
4. **Force re-login at cutover.** No session migration. User emails existing accounts a heads-up. Clean break.
5. **Same repo, `migration/next` branch, Railway preview env.** Confirmed.
6. **Opportunistic cutover with hard conditions.** Three blocking checkboxes guard Phase 5 entry (well-rested, 4+ hours, no late-night/pre-meeting/pre-travel).
7. **Stripe test mode in preview env from Phase 1.** Test-mode keys set in Railway preview; live keys stay in Railway production. Never mixed.
8. **Fix two bugs on vanilla `main` first.** Pre-Phase-0 section added. Commits cherry-picked into `migration/next`.

---

## 8. Phase 0 — Detailed Work Breakdown

### Pre-Phase-0: Bug Fixes on `main` (do BEFORE creating `migration/next` branch)

**Assigned to:** Frontend agent
**Ship via:** `/ship` skill
**Record commit SHAs for cherry-pick:** `BUG_FIX_SHA_1 = ___`, `BUG_FIX_SHA_2 = ___`

**Bug 1 — `f.impact` → `f.direction` (factor chip color-coding broken)**

- File: `js/app.js`
- Locations: **line 496** (inside `renderSpotGrid`, the spot-card factor chip loop) and **line 721** (inside `renderFactorChips`, the modal factor chip renderer)
- Root cause: both sites set `chip.className = \`factor-chip ${f.impact} ${f.severity || 'medium'}\`` but `compute-visibility.js` writes the field as `f.direction`, not `f.impact`. The undefined access silently appends `"undefined"` as a CSS class, breaking color-coding on all spot cards.
- Fix: at both line 496 and line 721, replace `f.impact` with `f.direction || ''`.
- Test: after fix, open a spot card with known factor data; the chip should have class `factor-chip positive medium` or `factor-chip negative medium` (not `factor-chip undefined medium`).

**Bug 2 — `applyAuthUi()` modal lock not cleared on auth change**

- File: `js/app.js`
- Location: **line 160** — `function applyAuthUi()` (called at lines 58, 195, 906, 952, 968)
- Root cause: `applyAuthUi()` updates body classes and the account chip, but does not re-evaluate the open spot modal's lock state. When a user signs in while a spot modal is open, `gatedTiles` (locked at line 564) and `premiumWrap` (locked at lines 604–609) keep the `.locked` class because `openSpotModal()` is not re-called.
- Fix: add a module-level variable `STATE.openSpotSlug = null`. Set it when `openSpotModal(slug)` is called; clear it when `closeModal('spotModal')` is called. In `applyAuthUi()`, after the chip update, check if `document.getElementById('spotModal').style.display === 'flex'` and `STATE.openSpotSlug` is set — if so, call `openSpotModal(STATE.openSpotSlug)` to re-render lock state.
- Test: open a spot modal while logged out → modal shows locked tiles → sign in without closing the modal → tiles should immediately unlock.

---

### Phase 0: Infra Prep — Step-by-Step

**Goal:** `migration/next` branch boots a Hello World Next.js page at the Railway preview URL. Next.js boots, Tailwind renders a class, Prisma connects to preview Postgres.

---

**Step 1 — Create the branch**

User (or Backend agent) runs:
```bash
git checkout main
git pull origin main
git checkout -b migration/next
git push -u origin migration/next
```

---

**Step 2 — Railway preview environment provisioning** (Backend agent)

- Add Postgres addon to the Railway preview service (the service that deploys from `migration/next`).
- Copy these env vars from production to preview, substituting test-mode Stripe values:

| Var | Source |
|---|---|
| `DATABASE_URL` | Auto-injected from Postgres addon |
| `NEXTAUTH_SECRET` or `SESSION_SECRET` | Generate new: `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | Stripe test-mode key (`sk_test_...`) |
| `STRIPE_PRICE_ID_MONTHLY` | Stripe test-mode price ID |
| `STRIPE_PRICE_ID_ANNUAL` | Stripe test-mode price ID |
| `STRIPE_WEBHOOK_SECRET` | Stripe test-mode webhook secret (`whsec_...`) |
| `RESEND_API_KEY` | Same as production (sandbox sends OK) |
| `ANTHROPIC_API_KEY` | Same as production |
| `NASA_EARTHDATA_USER` / `NASA_EARTHDATA_PASS` | Same as production |
| `BASE_URL` | Railway preview URL (e.g. `https://nautical-nick-web-migration.up.railway.app`) |
| `NODE_ENV` | `production` |

- Set Railway build command: `npx prisma generate && next build`
- Set Railway start command: `next start`

---

**Step 3 — Package installs** (Backend agent updates `package.json`)

Add to `dependencies`:
```json
"next": "15.3.1",
"react": "19.1.0",
"react-dom": "19.1.0",
"@prisma/client": "6.6.0"
```

Add to `devDependencies`:
```json
"typescript": "5.8.3",
"@types/node": "22.14.1",
"@types/react": "19.1.2",
"@types/react-dom": "19.1.2",
"prisma": "6.6.0",
"tailwindcss": "4.1.4",
"@tailwindcss/postcss": "4.1.4"
```

**Version notes:**
- Next.js 15 (specifically 15.x LTS line, React 19 peer dep) is chosen over 14.x because 15 shipped stable with the App Router improvements and is the current LTS as of April 2026. Next 14 would also work but 15 is the safer long-term choice.
- Tailwind v4 (released Feb 2025) uses `@tailwindcss/postcss` instead of the old `postcss` plugin pattern. No separate `autoprefixer` needed — v4 handles vendor prefixes internally.
- Prisma 6.x is current stable as of April 2026.

---

**Step 4 — Config files** (Backend agent creates)

**`tsconfig.json`** at repo root:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Note: `paths` alias is `@/*` → `./*` (no `src/` directory; App Router files go in `app/` at root).

**`next.config.mjs`** at repo root:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Raw body needed for Stripe webhook route
  // Configured per-route via route segment config in Phase 1
};
export default nextConfig;
```

**`postcss.config.mjs`** at repo root (Tailwind v4 style):
```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

**`tailwind.config.ts`** at repo root:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand tokens from css/style.css :root
        'nn-bg':           '#0a2a3a',
        'nn-panel':        '#0d3347',
        'nn-panel-hover':  '#0f3d56',
        'nn-cyan':         '#4ad8f5',
        'nn-cyan-bright':  '#00e5ff',
        'nn-cyan-dim':     '#3ab5d0',
        'nn-orange':       '#ff7a2f',
        'nn-green':        '#00e676',
        'nn-yellow':       '#ffd600',
        'nn-red':          '#ff1744',
        'nn-text':         '#dff4fa',
        'nn-text-dim':     '#7ba9c0',
        'nn-text-muted':   '#456a80',
      },
    },
  },
  plugins: [],
};

export default config;
```

---

**Step 5 — Prisma skeleton** (Backend agent creates `prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Stub — full schema added in Phase 1
model _Migration {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())
}
```

---

**Step 6 — App Router skeleton** (Frontend agent creates)

**`app/globals.css`:**
```css
@import "tailwindcss";

/* Full css/style.css port happens in Phase 4.
   Brand color tokens are defined in tailwind.config.ts.
   This file will expand significantly during Phase 4. */
```

Note: Tailwind v4 uses `@import "tailwindcss"` instead of the v3 `@tailwind base/components/utilities` directives.

**`app/layout.tsx`:**
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nautical Nick — Ocean Visibility Report',
  description: 'Daily underwater visibility forecasts for San Diego spearfishing spots.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

**`app/page.tsx`:**
```tsx
export default function Page() {
  return (
    <main className="text-nn-cyan p-8">
      <h1>Nautical Nick — Migration in Progress</h1>
      <p className="text-nn-text-dim">
        The full site is coming. This placeholder confirms Next.js + Tailwind are wired.
      </p>
    </main>
  );
}
```

---

**Step 7 — `.env.example` additions** (Backend agent)

Add to `.env.example`:
```bash
# ── Database (NEW — Phase 0) ────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@host:5432/dbname

# ── Auth (NEW — Phase 0) ───────────────────────────────────────────────────
SESSION_SECRET=replace-with-openssl-rand-hex-32

# ── Stripe (RENAMED — was STRIPE_PRICE_ID) ─────────────────────────────────
# Use test-mode keys in preview env; live keys in production env only.
STRIPE_PRICE_ID_MONTHLY=price_test_xxx
STRIPE_PRICE_ID_ANNUAL=price_test_xxx

# ── Removed ─────────────────────────────────────────────────────────────────
# DATA_DIR is no longer needed; replaced by Postgres + /data/snapshots mount.
```

---

### Phase 0 Exit Criteria

All must be checked before Phase 0 is declared done:

- [ ] `migration/next` branch pushed to origin
- [ ] Railway preview environment builds without error
- [ ] Preview URL (`https://<preview>.railway.app/`) returns 200 and renders "Migration in Progress"
- [ ] A Tailwind class (`text-nn-cyan` or similar) renders visibly in the placeholder page
- [ ] `npx prisma generate` completes without error
- [ ] `npx prisma db push` (or `migrate dev`) connects to preview Postgres without error
- [ ] No TypeScript errors: `npx tsc --noEmit` passes

---

### Phase 0 Per-Agent Assignment

| Task | Agent |
|---|---|
| Create `migration/next` branch | Backend |
| Railway Postgres addon + env vars | Backend |
| `package.json` dependency additions | Backend |
| `tsconfig.json`, `next.config.mjs` | Backend |
| `prisma/schema.prisma` stub | Backend |
| `postcss.config.mjs` | Backend |
| `tailwind.config.ts` (config + brand tokens) | Backend (structure) + Frontend (confirm token values from `css/style.css`) |
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | Frontend |
| `.env.example` updates | Backend |
| Verify all 7 exit criteria | Backend + Frontend jointly |

**Estimated wall-clock time:** 1.5–2 hours (one working session)

---

_End of plan. Status: APPROVED — Decisions Locked 2026-04-22._
