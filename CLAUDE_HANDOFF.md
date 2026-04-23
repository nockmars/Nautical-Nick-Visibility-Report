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
