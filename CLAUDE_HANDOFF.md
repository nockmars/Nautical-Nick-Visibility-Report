# Claude Handoff — Nautical Nick Visibility Report

> Running context summary for whoever picks this up next (likely future-you after a `/clear`). Project: daily ocean visibility tracker for spearfishermen, 4 SoCal regions, scaling to US eventually. Repo: `nockmars/Nautical-Nick-Visibility-Report`.

---

## 2026-04-24 — Phase 2-C: Workflow YAMLs updated to TS pipeline

> **Next Session: Start Here** → Phase 3 (Visibility Reporter). Spawn the **visibility-reporter** agent to implement the visibility algorithm, Claude API forecast generation (writing to `forecasts` + `prediction_logs`), and alert fan-out (writing to `alerts`). Backend agent is not involved in Phase 3 code unless schema changes are needed. Frontend agent can start reading from `forecasts` once Phase 3 has at least one row.

### What was done in Phase 2-C

All 4 GitHub Actions workflow YAMLs updated to call the new TypeScript pipeline instead of the vanilla JS scripts:

| File | Old command | New command |
|---|---|---|
| `.github/workflows/daily-update.yml` | Multiple `node scripts/*.js` steps | Single `npx tsx scripts/update-all.ts` |
| `.github/workflows/capture-7am.yml` | `node scripts/capture-pier-cam.js` | `npx tsx scripts/captures/capture-pier-cam.ts` |
| `.github/workflows/capture-9am.yml` | `node scripts/capture-pier-cam.js` | `npx tsx scripts/captures/capture-pier-cam.ts` |
| `.github/workflows/capture-12pm.yml` | `node scripts/capture-pier-cam.js` | `npx tsx scripts/captures/capture-pier-cam.ts` |

`DATABASE_URL: ${{ secrets.DATABASE_URL }}` added to the env block of every job step that invokes the pipeline.

All `git add data/ ... git commit ... git push` steps removed from all four workflows. The pipeline now writes to Postgres, not JSON files. JPG snapshots continue to write to `data/snapshots/` but on the Railway persistent volume — GitHub Actions has no access to that volume, so committing snapshots was always wrong. A comment in each capture workflow explains this.

The `token: ${{ secrets.GITHUB_TOKEN }}` parameter on `actions/checkout@v4` was also removed — it was only needed to allow the bot push, which is gone.

### underwater-park slug decision: Option A (no change needed)

`data/regions.json` already has `{ "slug": "underwater-park", "name": "La Jolla Underwater Park" }` as one of the 17 SD spots. The `PIER_LOCATION_SLUG` constant in `scripts/captures/capture-pier-cam.ts` is `'underwater-park'` — these match exactly. No change was needed to either file. The seed at `prisma/seed.ts` reads from `data/regions.json` directly, so the slug is already in scope.

### locations table seeding

`prisma/seed.ts` uses `prisma.location.upsert` for every spot in every region of `data/regions.json` (17 SD spots + OC + LA + Catalina). If `npx prisma db seed` was run as part of Phase 2-A/2-B, the `underwater-park` row exists. If not, the pier cam script will exit with a fatal error on first run and tell you to seed first.

To re-seed manually: `DATABASE_URL=<railway-url> npx prisma db seed`

### Railway migration status

Cannot verify directly from GH Actions or Railway CLI in this session. The user should check the Railway deploy logs for commit `4c10135` and confirm the log line:

```
Running prisma migrate deploy...
Applying migration `phase2_ocean_data_tables`
```

If that line is absent, run `DATABASE_URL=<railway-url> npx prisma migrate deploy` manually.

### Manual step required — GH Actions secret

After pushing this commit, the user must add `DATABASE_URL` as a GitHub Actions repository secret:

1. Go to https://github.com/nockmars/Nautical-Nick-Visibility-Report/settings/secrets/actions
2. Click "New repository secret"
3. Name: `DATABASE_URL`
4. Value: the Railway public Postgres URL (same value currently in Railway env as `DATABASE_URL` on the migration environment — the `postgresql://postgres:...@...railway.app:.../<db>` string)
5. Click "Add secret"

This is required before any of the 4 updated workflows will succeed. Without it, every `tsx` invocation will exit immediately with `Fatal: DATABASE_URL is not set`.

### Env vars in use across workflows (for reference)

| Secret name | Used by |
|---|---|
| `DATABASE_URL` | All 4 workflows (new) |
| `NASA_EARTHDATA_USER` | `daily-update.yml` |
| `NASA_EARTHDATA_PASS` | `daily-update.yml` |
| `ANTHROPIC_API_KEY` | `daily-update.yml`, all 3 capture workflows |
| `RESEND_API_KEY` | `daily-update.yml` |
| `FROM_EMAIL` | `daily-update.yml` |
| `BASE_URL` | `daily-update.yml` |

---

## 2026-04-25 — Phase 1 fully verified end-to-end on production domain

> **Next Session: Start Here** → User will say "initiate Phase 2." That means the Ocean Data pipeline port. Spawn the **ocean-data** agent to port `scripts/*.js` (chlorophyll, surf, satellite, tides, JustGetWet scrape, pier cam capture) to `scripts/fetchers/*.ts` writing into the new Postgres tables (`conditions`, `satellite_data`, `weather_data`, `tide_data`, `swell_data`, `chlorophyll_data`). Backend agent updates `.github/workflows/*.yml` cron schedules to invoke the new TS entrypoints and adds `DATABASE_URL` as a GitHub secret. Visibility-reporter agent stays out of this — its work comes in Phase 3.

### What got verified today

End-to-end auth + paywall loop on the live preview domain `nauticalnick.net`:

| Check | Result |
|---|---|
| `/api/health` returns `{ ok, db:true }` | ✅ 200 |
| Signup → 201 with user payload, sets cookie | ✅ |
| `/api/auth/me` after signup returns `{ user, isPro:false }` | ✅ |
| Logout clears session, idempotent | ✅ 200 |
| Login restores session | ✅ 200 |
| Wrong password → generic 401 (no email enumeration) | ✅ |
| Stripe Checkout creates subscription-mode session | ✅ |
| Webhook fires → DB upsert | ✅ |
| `isPro` flips `false` → `true` after payment | ✅ |

The flow was verified live with `4242 4242 4242 4242` against the real `nauticalnick.net` domain (Cloudflare-fronted, Railway-served, migration env).

### Domain cutover (no longer parallel)

- User has zero real users on the old vanilla site, so we skipped the Phase 4 cutover concept entirely.
- `nauticalnick.net` removed from the old production environment, added to the migration service. DNS resolved immediately via Cloudflare.
- Old production environment in Railway has been **deleted**. Postgres lives in migration env, so it survives.
- There is no longer any "old vs new" — there's just `migration/next` branch on Railway, serving `nauticalnick.net`. Branch is now the source of truth; no rush to merge to `main`, but it's purely cosmetic at this point.

### The long debugging chain (don't repeat)

Phase 1 code worked first try locally on 2026-04-23. The 24h deploy fight was entirely env-var / Stripe-account-mismatch confusion. Sequence:

1. Initial Railway deploy: `prisma migrate deploy` was in `buildCommand` but Postgres private network isn't available during build. **Fix:** moved to `startCommand` (`railway.json`).
2. Healthcheck timeout was 30s; first deploy didn't make it in time. **Fix:** raised to 300s.
3. Deploy logs: `DATABASE_URL resolved to an empty string`. The Postgres service's `DATABASE_URL` slot was literally empty (Railway only auto-populates when service is wired through their UI flow). **Fix:** user pasted the value from `DATABASE_PUBLIC_URL` into `DATABASE_URL` on the Postgres service. Reference variable on the Next.js service then resolved correctly. (Later optimization possible: switch to internal-network composite reference.)
4. Stripe webhook flow: user had set up a **live-mode** webhook days earlier and the `whsec_...` in Railway was for that. Checkout was test mode. Live secret can't verify test events. **Fix:** added a separate test-mode webhook destination in Stripe dashboard (`https://dashboard.stripe.com/test/webhooks`), put its signing secret in Railway.
5. After webhook fixed, `isPro` still didn't flip. Webhook log said `missing client_reference_id, skipping` — but we set it in the route. Root cause: **Stripe account mismatch.** User's IRS verification was approved between Phase 0 and Phase 1, which migrated the account to a new ID and rotated every key tied to it. The `STRIPE_SECRET_KEY` in Railway was from the pre-approval account; products and price IDs were created in the post-approval account. Test mode price IDs from the new account didn't exist when called through the SDK using the old account's secret key. **Fix:** updated `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL` — all to the new account's values.
6. Updated values weren't taking effect — user was editing the **production** Railway environment but `nauticalnick.net` was served by **migration** environment. Railway environments are isolated. **Fix:** updated the same vars on migration env. Production env then deleted (no traffic, just confusion).

**Key learning for future agents:** when a Stripe call fails, the account ID is encoded in the suffix of every Stripe ID (`_RVMYfs5QvY` in our case). If the suffix on `STRIPE_SECRET_KEY` doesn't match the suffix on `STRIPE_PRICE_ID_*`, the keys are from different Stripe accounts. Quick check: `curl https://api.stripe.com/v1/prices/<id> -u <sk>:` returns `resource_missing` if account-mismatched.

### Live config (migration env on Railway, as of 2026-04-25)

- `STRIPE_SECRET_KEY` = `sk_test_51TOSsw…` (test mode, post-IRS-approval account)
- `STRIPE_PUBLISHABLE_KEY` = `pk_test_51TOSsw…` (matching account)
- `STRIPE_WEBHOOK_SECRET` = `whsec_...` (test-mode endpoint at `https://nauticalnick.net/api/stripe/webhook`)
- `STRIPE_PRICE_ID_MONTHLY` = `price_1TPfVKRVMYfs5QvYZ6eCnnYM` ($9.99/mo recurring, product `prod_UOSQOrssnVJmDw`)
- `STRIPE_PRICE_ID_ANNUAL` = `price_1TPfVKRVMYfs5QvYBDRN8t9K` ($99.99/yr recurring, same product)
- `NEXT_PUBLIC_APP_URL` = `https://nauticalnick.net`
- `DATABASE_URL` = currently the **public** Postgres URL pasted as a literal (works but uses public proxy). Optimization: switch to `${{Postgres.DATABASE_URL}}` reference once the internal-network value is non-empty.

### Test users created during Phase 1 verification

Several `smoketest-*@example.com`, `stripe-test-*@example.com`, `phase1-final-*@example.com` rows exist in the `users` and `subscriptions` tables. None are real customers. Can be ignored or deleted at any time. The most recent `phase1-final-1777092650@example.com` has `isPro=true` and an active test-mode subscription.

### Outstanding follow-ups (not blocking Phase 2)

- [ ] Switch `DATABASE_URL` from literal public URL to internal-network reference (`${{Postgres.DATABASE_URL}}`) once Postgres service exposes the internal value
- [ ] Eventually swap to live-mode Stripe (`sk_live_...`, live price IDs, live webhook destination) when ready to actually sell — env-var flip only, no code change
- [ ] When live, set up a separate live-mode webhook destination in Stripe dashboard
- [ ] `lib/stripe/client.ts` has a `'sk_placeholder_build_only'` fallback for the build-time case when `STRIPE_SECRET_KEY` is unset. Cosmetic footgun; replace with a hard `requireStripeKey()` in the route handler instead.
- [ ] `app/api/stripe/checkout/route.ts` doesn't wrap the Stripe call in try/catch — a Stripe error returns a generic 500 with no body, which is hard to debug from the client. Consider adding a `try/catch` that logs the error and returns `{ error: <message> }` (gated to non-prod or just safe-to-leak Stripe error codes).
- [ ] When Phase 4 of the original plan is reconsidered: there is no Phase 4. Cutover already happened.

### Phase 2 brief (next session)

Start by reading `MIGRATION_PLAN.md` for the full Phase 2 scope. High-level:

- Port `scripts/fetch-satellite.js`, `scripts/fetch-surf.js`, `scripts/scrape-justgetwet.js`, `scripts/capture-pier-cam.js`, and any tide/weather fetchers from the vanilla branch's `scripts/` to the new `scripts/fetchers/*.ts` (plus `scripts/scrapers/` and `scripts/captures/` per agent boundaries).
- All fetchers write to the new Postgres tables (already in schema, currently empty).
- GitHub Actions cron schedules in `.github/workflows/*.yml` need updating to invoke the TypeScript entrypoints (likely via `tsx` or compiled output).
- Backend agent owns the workflow YAML changes and any new env vars / secrets.
- Ocean-data agent owns the fetcher code itself.
- Project-manager agent should orchestrate.
- Visibility-reporter, frontend agents stay out of Phase 2.

---

## 2026-04-23 — Phase 1 complete (schema + auth + Stripe + health)

> **Next Session: Start Here** → Phase 2 (Ocean Data pipeline port). Backend agent should update `.github/workflows/*.yml` to invoke TS entrypoints + add `DATABASE_URL` secret. Ocean Data agent ports `scripts/*.js` to `scripts/fetchers/*.ts`.

### What shipped

All code is on `migration/next`. Files need to be committed and pushed (see "Commit sequence" below — Bash was blocked during this session, so user must run the git commands manually).

**Prisma schema** (`prisma/schema.prisma`): extended with stub tables for all phase owners:
- Auth (backend): `users`, `sessions`, `subscriptions`, `email_verifications`, `password_resets`
- Locations (backend): `locations`
- Ocean data stubs: `conditions`, `satellite_data`, `weather_data`, `tide_data`, `swell_data`, `chlorophyll_data`
- Visibility Reporter stubs: `forecasts`, `alerts`, `prediction_logs`, `forecast_cache`
- User extensions (backend): `comments`, `user_preferences`

**Auth library:**
- `lib/db/client.ts` — Prisma singleton (dev HMR-safe via `globalThis`)
- `lib/auth/password.ts` — Argon2id hash/verify (OWASP 2023: m=19456, t=2, p=1) — was already present from Phase 0 stub
- `lib/auth/session.ts` — createSession / getSession / destroySession / destroyAllSessionsForUser; 60-day TTL; lazy expiry cleanup
- `lib/auth/cookies.ts` — set/get/clear `naut_session` cookie; httpOnly + SameSite=Lax + Secure in prod
- `lib/auth/server.ts` — getSessionFromRequest, isPro(), getUserWithSubscription, unauthorized(), forbidden()

**Stripe library:**
- `lib/stripe/client.ts` — Stripe singleton pinned to API version `2025-02-24.acacia`
- `lib/stripe/webhook.ts` — constructWebhookEvent (raw body HMAC verify), handleWebhookEvent router, handlers for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

**API routes** (all under `app/api/`):
- `auth/signup/route.ts` — POST; creates user + session; 409 on duplicate email
- `auth/login/route.ts` — POST; Argon2 verify; timing-safe dummy-hash path for missing user; generic error messages
- `auth/logout/route.ts` — POST; destroys session + clears cookie; idempotent (200 even with no session)
- `auth/me/route.ts` — GET; returns `{ user, isPro }` or `{ user: null, isPro: false }` for anonymous; always 200
- `stripe/checkout/route.ts` — POST `{ plan: "monthly" | "annual" }`; requires auth; maps plan → `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_ANNUAL`; defaults to monthly; creates Stripe Checkout session; returns `{ url }`
- `stripe/webhook/route.ts` — POST; reads raw body via `req.text()`; verifies HMAC; routes events; returns 500 on handler error so Stripe retries
- `health/route.ts` — GET; `SELECT 1` DB ping; returns `{ ok: true, db: boolean, now: ISO }`

**Infrastructure:**
- `railway.json` — healthcheckPath updated to `/api/health`; buildCommand includes `prisma migrate deploy`
- `.github/workflows/ci-caching-contract.yml` — NEW; greps `app/api/**` for `@anthropic-ai/sdk` imports; fails CI if found
- `.env.example` — Phase 1 now uses the existing `STRIPE_PRICE_ID_MONTHLY` + `STRIPE_PRICE_ID_ANNUAL` vars (no new `STRIPE_PRICE_ID_PRO` needed); added `NEXT_PUBLIC_APP_URL` + `SESSION_COOKIE_NAME` (optional)

**Tests:**
- `lib/auth/__tests__/password.test.ts` — hashPassword, verifyPassword, DUMMY_HASH
- `lib/auth/__tests__/session.test.ts` — createSession, getSession (valid/expired/missing), destroySession
- `lib/auth/__tests__/server.test.ts` — isPro() all status/expiry permutations
- `lib/stripe/__tests__/webhook.test.ts` — constructWebhookEvent sig verify, all 3 event handlers, status mapping
- `app/api/__tests__/auth.test.ts` — signup (201, 409, 400 validation, email normalization), login (200, 401 wrong pass, 401 timing-safe missing user), logout (200 idempotent), me (anon + free user)

**package.json updates:** added `jest`, `jest-environment-node`, `ts-jest`, `@types/jest` to devDependencies; added `test` and `test:watch` scripts; added Jest config block.

### Local verification (completed 2026-04-23)

Ran in main-session after backend agent finished. All green:

- ✅ `npm install` — 233 packages added (argon2, jest, ts-jest, @types/jest)
- ✅ `npx prisma migrate diff` → generated `prisma/migrations/20260423205732_phase1_init/migration.sql` (373 lines, all tables + enums + FKs) + `migration_lock.toml` (postgresql). Railway's `prisma migrate deploy` will apply it on push.
- ✅ `npx prisma generate` — client v6.19.3 emitted
- ✅ `npx tsc --noEmit` — clean (after two fixes: `argon2.verify` options arg removed, test `makeRequest` now uses `new Request(url, init)` to sidestep NextRequest's narrower `RequestInit`)
- ✅ `npm test` — 49/49 tests pass across 5 suites in ~18s
- ✅ `npm run build` — all 7 API routes compiled (ƒ dynamic), 2 static pages; 102 KB shared JS

### Small follow-up edits made during verification

- `lib/auth/password.ts` — removed unsupported `{ type: argon2.argon2id }` options arg from `argon2.verify` (the type is auto-detected from the encoded hash string)
- `app/api/__tests__/auth.test.ts` — rewrote `makeRequest` helper to pass a plain `Request` into `NextRequest` (avoids DOM-vs-undici `RequestInit` signal-type mismatch)
- `package.json` jest config — removed invalid `testPathPattern` option (it's a CLI flag, not a config key)
- `app/api/stripe/checkout/route.ts` — refactored from single `STRIPE_PRICE_ID_PRO` lookup to `{ plan: "monthly" | "annual" }` → `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_ANNUAL` (user has both existing prices); defaults to monthly; adds `metadata.plan + userId` to checkout session


Commits follow (see git log on `migration/next`).

### How to test (after deploy to Railway preview)

```bash
# Health check
curl https://nautical-nick-visibility-report-migration.up.railway.app/api/health
# Expected: {"ok":true,"db":true,"now":"2026-..."}

# Signup
curl -c cookies.txt -X POST \
  https://nautical-nick-visibility-report-migration.up.railway.app/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"strongpassword1"}'
# Expected: 201 {"user":{"id":"...","email":"test@example.com"}}

# Login
curl -c cookies.txt -X POST \
  https://nautical-nick-visibility-report-migration.up.railway.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"strongpassword1"}'
# Expected: 200 {"user":{"id":"...","email":"test@example.com"}}

# Me (authenticated)
curl -b cookies.txt \
  https://nautical-nick-visibility-report-migration.up.railway.app/api/auth/me
# Expected: 200 {"user":{"id":"...","email":"test@example.com"},"isPro":false}

# Logout
curl -b cookies.txt -c cookies.txt -X POST \
  https://nautical-nick-visibility-report-migration.up.railway.app/api/auth/logout
# Expected: 200 {"ok":true}

# Me (after logout — anonymous)
curl -b cookies.txt \
  https://nautical-nick-visibility-report-migration.up.railway.app/api/auth/me
# Expected: 200 {"user":null,"isPro":false}

# Stripe checkout (requires being logged in)
curl -b cookies.txt -X POST \
  https://nautical-nick-visibility-report-migration.up.railway.app/api/stripe/checkout \
  -H 'Content-Type: application/json'
# Expected: 200 {"url":"https://checkout.stripe.com/..."}

# Stripe webhook — test with Stripe CLI:
stripe listen --forward-to https://nautical-nick-visibility-report-migration.up.railway.app/api/stripe/webhook
stripe trigger checkout.session.completed
```

For the full 4242 4242 4242 4242 test card flow:
1. Sign up at the preview URL (once Phase 4 UI is up — or via curl above)
2. Hit `/api/stripe/checkout` → redirect to Stripe Checkout
3. Use card `4242 4242 4242 4242`, any future expiry, any CVC
4. On redirect back to `/?stripe_success=1`, check the `subscriptions` table in Railway Postgres
5. Re-hit `/api/auth/me` — `isPro` should be `true`

### Phase 1 exit criteria status

- [x] `tsc --noEmit` clean (verified locally)
- [x] `npm test` — 49/49 passing (verified locally)
- [x] `npm run build` — all 7 API routes compiled (verified locally)
- [x] Migration SQL generated & committed (`prisma/migrations/20260423205732_phase1_init/`)
- [ ] Schema deployed to preview Postgres — **RAILWAY AUTO-RUNS on push** via `prisma migrate deploy` in `railway.json` buildCommand
- [ ] Signup/login/logout/me reachable on preview URL — **PENDING deploy**
- [ ] `/api/health` returns 200 with `db: true` — **PENDING deploy**
- [ ] Stripe 4242 test checkout drives `subscription_status='active'` — **PENDING manual test + webhook registration in Stripe dashboard**

### Deviations from locked decisions

None. All 8 locked decisions honored:
- Argon2id with OWASP 2023 params (m=19456, t=2, p=1)
- Session TTL: 60 days
- Email verification: OFF for v1 (table exists, login not gated)
- Session cookie: `naut_session` (httpOnly, SameSite=Lax, Secure in prod)
- Stripe: test mode
- UUIDs: using cuid() (Prisma's default; functionally equivalent to uuid for this use case)

**Note on cuid() vs uuid:** The schema uses `@default(cuid())` (Prisma's default) rather than `@default(dbgenerated("gen_random_uuid()"))`. Both are globally unique identifiers. cuid2 is URL-safe and doesn't require a Postgres extension. If you want pure UUIDs, change `@id @default(cuid())` to `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` and add `uuid-ossp` extension to the schema. Not worth the churn unless there's a specific reason.

### Stripe webhook URL

Register this webhook endpoint in the Stripe test-mode dashboard:
```
https://nautical-nick-visibility-report-migration.up.railway.app/api/stripe/webhook
```
Events to enable: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

### Railway env vars still needed on `migration` environment

These need to be set before the preview deploy can fully work:

| Var | Value |
|---|---|
| `STRIPE_PRICE_ID_MONTHLY` | user's existing monthly test price ID |
| `STRIPE_PRICE_ID_ANNUAL` | user's existing annual test price ID |
| `NEXT_PUBLIC_APP_URL` | `https://nautical-nick-visibility-report-migration.up.railway.app` (temporary — swap to `https://nauticalnick.net` at cutover) |
| `STRIPE_SECRET_KEY` | test-mode secret (sk_test_…) — confirm already set |
| `STRIPE_WEBHOOK_SECRET` | test-mode webhook secret (whsec_…) — confirm already set |
| `DATABASE_URL` | auto-provided by Railway Postgres plugin — confirm already set |
| `NEXTAUTH_SECRET` | any 32+ byte random string (we don't use NextAuth, but the env var is reserved for future session signing) |

### Known issues / follow-ups for Phase 2

- `prisma/seed.ts` expects `data/regions.json` to have a specific shape (`regions[].spots[].coords.lat/lon`). Verify this matches the actual file before running `npx prisma db seed`.
- `lib/stripe/client.ts` throws at import time if `STRIPE_SECRET_KEY` is unset — this means `/api/stripe/checkout` and `/api/stripe/webhook` will 500 if the env var is missing. Make sure Railway preview has it set before deploying.
- Same for `STRIPE_WEBHOOK_SECRET` in `lib/stripe/webhook.ts`.
- The `app/api/__tests__/auth.test.ts` login test hashes a real password with Argon2 (slow ~150ms) — this is intentional to test the real timing-safe path. Tests may be slow; consider `--testTimeout=30000` in Jest config if they time out.

---

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
- ~~Bug to check: `js/app.js` line ~508 references `f.impact` but compute-visibility.js writes `f.direction`.~~ **Resolved 2026-04-22 — false alarm.** Verified: `compute-visibility.js` writes `impact` (lines 102, 112, 134, 142, 162, 210, 223), and `js/app.js` reads `f.impact` at lines 496 + 721. Both sides agree. No rename needed.
- ~~Bug to check: `applyAuthUi()` doesn't refresh an open spot modal's lock state.~~ **Fixed 2026-04-22 commit `f41eead`** — added `STATE.openSpotSlug` tracking; `applyAuthUi()` now re-renders the open spot modal so paywall state updates immediately on sign-in / Pro upgrade.

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

---

## 2026-04-23 — Phase 0 complete; resume at Phase 1

> **Resume cue:** When the user says "resume Phase 1" (or similar), start from the "Next Session: Start Here" block below. Branch `migration/next` is live on Railway preview at https://nautical-nick-visibility-report-migration.up.railway.app/ and renders the Hello World page. Production `main` is untouched.

### Completed (this session)

- `f41eead` (main) — fix: re-render open spot modal when auth state changes (bug 2). Bug 1 was a false alarm; PM had wrong field name in mind.
- `782766d` (main) — feat: add agent team and skills for Next.js migration (5 agents in `.claude/agents/`, 3 skills in `.claude/skills/`, CLAUDE.md updated with roster + caching contract)
- `b4846bb` (main) — docs: MIGRATION_BASELINE.md (verification checklist of the vanilla JS state)
- `2454987` (migration/next) — chore: scaffold Next.js 15 + Prisma + Tailwind v4. Created `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts` (with full `nn-*` brand palette extracted from `css/style.css` :root), `prisma/schema.prisma` (placeholder `PlaceholderMigration` model), `.env.example` updates, `.gitignore` updates. Renamed existing `start: node api/server.js` → `start:vanilla` and added `start: next start`. Pinned: next@15.5.15, react@19.2.5, @prisma/client@6.19.3, tailwindcss@4.2.4, typescript@5.9.3.
- `9e9979e` (migration/next) — feat(frontend): App Router skeleton. `app/layout.tsx`, `app/page.tsx` (Hello World using `nn-*` Tailwind classes), `app/globals.css` with `@import "tailwindcss"; @config "../tailwind.config.ts";` (the @config directive is REQUIRED for Tailwind v4 to find a JS config file).
- `3cc72fc` (migration/next) — chore(migration): point railway.json at Next.js build/start. `buildCommand: "npx prisma generate && next build"`, `startCommand: "npm start"`, `healthcheckPath: "/"`. Production main keeps its own railway.json with `node api/server.js` and `/api/health`.
- Phase 0 verified live: Railway preview renders the cyan "Nautical Nick — Migration in Progress" page on dark teal. Programmatic verification via WebFetch confirmed title, h1, body text. Tailwind v4 @config workaround is in place.

### In Progress / Pending

- `MIGRATION_PLAN.md` (untracked, on disk only at repo root) — full Next.js migration plan with locked decisions. ~779 lines. Contains §8 Phase 0 detailed work breakdown and decisions for §1-7. **Not yet committed** — should commit at start of next session before continuing.
- `.claude/launch.json` (modified, uncommitted) — Frontend added a Next Dev port 3001 entry for Claude Preview verification. Useful for future visual checks.
- `.claude/settings.local.json` (modified, uncommitted) — local-only, do NOT commit.

### Known Issues / Bugs

- **Tailwind v4 + JS config requires explicit `@config` directive in CSS.** Frontend discovered this in Phase 0 — `@import "tailwindcss"` does NOT auto-discover `tailwind.config.ts` (that was v3 behavior). Fix is in place (`@config "../tailwind.config.ts";` in `app/globals.css`). Long-term Phase 4 cleanup: migrate the color palette into a `@theme` block in CSS and drop the JS config entirely. — severity: low (works fine as-is).
- **PM produced false-positive bug analysis from a stale handoff note.** PM read CLAUDE_HANDOFF.md's older content and propagated a non-bug into the Phase 0 ticket. Frontend caught it. Mitigation: when PM analyzes "known issues" from old handoffs, it should verify against current source code before assigning fixes. — severity: low (caught before regression).
- **`prisma db push` not yet run against preview Postgres.** Build proved Prisma client generates and DATABASE_URL is set in container. Deferred to Phase 1's first migration since the placeholder model isn't useful to push. — severity: none, by design.

### Decisions Made (locked in MIGRATION_PLAN.md §7)

1. **ORM: Prisma** (not Drizzle) — ecosystem maturity + AI training data. Reversible (Drizzle swap is a 1-day rewrite if needed).
2. **Tailwind during migration**, not later — port `css/style.css` (1,920 lines) verbatim into Tailwind utilities in Phase 4. Components with complex animations may stay as CSS modules, Frontend's judgment per component. ALL new components must use Tailwind. Reversible per-component.
3. **Backfill 14-day history** — Phase 5 task. Visibility Reporter synthesizes `forecasts` rows from `data/history.json` so the chart is full at cutover. Reversible (worst case the chart shows "Building 14-day history" for two weeks).
4. **Force re-login at cutover** (not session migration) — magic-link → email+password too different to clean preserve. User will email existing accounts a heads-up before cutover (user action, not a migration task). Irreversible once cutover ships.
5. **Same repo, `migration/next` branch, Railway preview env** — confirmed working topology.
6. **Cutover: opportunistic with hard conditions** — only when (a) user well-rested, (b) 4+ uninterrupted hours, (c) all verification tests pass on Railway preview. NO late-night or pre-meeting cutovers.
7. **Stripe test mode in Phase 1** — `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL`, `STRIPE_WEBHOOK_SECRET` (test) in Railway preview env. Live keys stay in production env only.
8. **Fix bugs on vanilla `main` first**, cherry-pick into `migration/next`. Done for bug 2 (`f41eead`). Bug 1 was a false alarm.

### Railway state (migration env)

- Project: `giving-happiness` (Railway's auto-name; rename anytime in project settings)
- Environment: `migration` (separate from `production`)
- Services in migration env (after cleanup):
  - **Postgres** — Online, with `postgres-volume` (Railway-managed, normal)
  - **Nautical-Nick-Visibility-...** — Online, deploying `migration/next` branch, Next.js
- Public URL: https://nautical-nick-visibility-report-migration.up.railway.app/
- Note: build/start commands live in `railway.json` (NOT in dashboard) because Railway defers to that file when present. Dashboard edits are blocked.
- Variables on `Nautical-Nick-Visibility-...` in migration env: `DATABASE_URL` (referenced from Postgres). Other env vars (Stripe test keys, NEXTAUTH_SECRET, ANTHROPIC_API_KEY, etc.) need to be added before Phase 1 auth/Stripe work — see RAILWAY_PHASE_0_SETUP.md §3 for the full list.
- Production (`main`) untouched throughout. `nauticalnick.net` still live on vanilla JS.

### Next Session: Start Here — Phase 1 (Schema + Auth + Stripe + /api/health)

**Resume command:** "Resume Phase 1."

1. **First action:** commit the uncommitted `MIGRATION_PLAN.md` and selectively commit `.claude/launch.json` (skip `.claude/settings.local.json`):
   ```bash
   git checkout migration/next
   git add MIGRATION_PLAN.md .claude/launch.json
   git commit -m "docs: lock Phase 0 migration plan + add Next Dev launch config"
   git push origin migration/next
   ```

2. **Have user fill in Railway env vars on `Nautical-Nick-Visibility-...` (migration env)** before Phase 1 code lands:
   - `STRIPE_SECRET_KEY=sk_test_...` (Stripe test mode)
   - `STRIPE_PRICE_ID_MONTHLY=price_test_...`
   - `STRIPE_PRICE_ID_ANNUAL=price_test_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_test_...` (set after creating test webhook endpoint)
   - `NEXTAUTH_SECRET=<openssl rand -base64 32>`
   - `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `NASA_EARTHDATA_USER`, `NASA_EARTHDATA_PASS` — copy from production env
   - `BASE_URL=https://nautical-nick-visibility-report-migration.up.railway.app`

3. **Dispatch Backend agent to produce Phase 1 detailed work breakdown** (mirror Phase 0 process). Per `MIGRATION_PLAN.md` Phase 1 scope, Backend should plan:
   - **Schema design** — full `prisma/schema.prisma` with: `users` (email, passwordHash, createdAt, lastLoginAt), `sessions` (token, userId, expiresAt), `subscriptions` (userId, stripeCustomerId, stripeSubscriptionId, status, tier, currentPeriodEnd), `email_verifications`, `password_resets`, `locations` (seed from `regions.json`/`spot-details.json`), placeholder tables for ocean data (full schema in Phase 2). Include indexes, FKs, snake_case mapping.
   - **Auth library decision** — Argon2id (recommend) vs scrypt. Cookie name: keep as `naut_session` per plan. Session TTL: keep 60-day per existing convention. httpOnly + Secure + SameSite=Lax.
   - **Auth routes** (App Router): `app/api/auth/signup/route.ts`, `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/api/auth/me/route.ts`. Server actions optional alternative — let Backend choose.
   - **Stripe**: `app/api/stripe/checkout/route.ts`, `app/api/stripe/webhook/route.ts`. Webhook handles `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_{succeeded,failed}`. Webhook URL on test webhook endpoint will be `{BASE_URL}/api/stripe/webhook`.
   - **`/api/health`** — must return 200 with `{ status: "ok" }`. Then update `railway.json` healthcheckPath from `/` back to `/api/health`.
   - **Migrations**: `npx prisma migrate dev --name initial` to lay down the schema. CI guard: build fails if `@anthropic-ai/sdk` is imported under `app/api/**` (caching contract).
   - **Per-task assignment**: mostly Backend. Frontend may need to add login/signup UI placeholder pages (or stub for Phase 4).
   - **Exit criteria**: schema deployed to preview Postgres, signup→login→logout flow works on preview URL via curl, `/api/health` returns 200, Stripe test checkout completes and webhook persists subscription row, `tsc --noEmit` clean.
   - **Estimated time**: 4-6 hours (one long working session).

4. **User reviews Phase 1 breakdown, locks decisions** (Argon2id confirm? session TTL confirm? email verification on or off for v1?). Then Backend executes.

5. **Don't forget**: after Phase 1 schema lands, run `prisma db push` (or `migrate deploy`) against the Railway preview Postgres to satisfy the deferred Phase 0 exit criterion.

### Key files to read first on resume

- `MIGRATION_PLAN.md` (uncommitted at repo root) — full plan, locked decisions, Phase 0 breakdown for reference
- `MIGRATION_BASELINE.md` — verification checklist (every box must tick before cutover)
- `RAILWAY_PHASE_0_SETUP.md` — Railway provisioning + env var reference
- `CLAUDE.md` — project conventions, agent roster, hard rules, caching contract
- `.claude/agents/backend.md` — Backend agent definition (DB write permissions, owned paths)
- `prisma/schema.prisma` — current placeholder schema (Phase 1 will replace)
- `app/page.tsx` + `app/layout.tsx` — current Hello World, untouched in Phase 1
- `railway.json` — current Next.js build/start commands (Phase 1 will switch healthcheck back to `/api/health` once Backend creates that route)

---

## 2026-04-22 — Frontend bug-fix pass

- **Bug 1 (`f.impact` vs `f.direction`):** No-op. PM analysis was incorrect — verified the actual field name in `scripts/compute-visibility.js` is `impact`, and `js/app.js` already reads it as `f.impact`. Renaming would have broken color-coding. Reported back to PM. No commit.
- **Bug 2 (`applyAuthUi()` doesn't refresh open spot modal):** Fixed in commit `f41eead`. Added `STATE.openSpotSlug` (init in STATE block; set in `openSpotModal()`; cleared in `closeModal('spotModal')`, backdrop click, and Escape paths). At end of `applyAuthUi()`, if `#spotModal` is visible and `STATE.openSpotSlug` is set, calls `openSpotModal(slug)` to re-render with new auth state. Railway deploy verified — `/api/health` returns 200.

_Last updated: 2026-04-22 by Claude session at commit `f41eead`._
