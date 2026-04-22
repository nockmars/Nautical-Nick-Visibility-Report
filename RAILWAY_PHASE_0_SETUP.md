# Railway Phase 0 Provisioning Checklist

This document captures the manual Railway dashboard steps required before
the `migration/next` branch can boot end-to-end. Backend agent owns this
file; Project Manager / human operator runs the steps.

> **Goal of Phase 0:** stand up a parallel Railway environment (and its
> Postgres + env vars) tied to the `migration/next` branch so we can
> develop, deploy, and smoke-test the new Next.js stack without touching
> the live `main` (vanilla JS / Express) production deploy.

---

## 1. Branch + environment topology

We keep **one Railway project**, with two environments:

| Environment | Source branch | Purpose | Public URL |
|---|---|---|---|
| `production` | `main` | Live vanilla JS site (current) | `nauticalnick.net` |
| `migration` | `migration/next` | Next.js 15 + Prisma preview | Railway-assigned (`*.up.railway.app`) |

Production stays untouched until cutover (Phase 5). The `migration`
environment is throwaway — it gets recreated/destroyed freely.

### Steps in Railway dashboard
1. Open the Nautical Nick project → **Settings** → **Environments**.
2. Click **New Environment** → name it `migration`.
3. **Duplicate variables from `production`** (Railway offers this in the
   create dialog) so all current vars are seeded, then override the ones
   below.
4. Under **Service → Settings → Source**, set the deploy branch for the
   `migration` environment to `migration/next`. Leave `production` on
   `main`.
5. Disable auto-deploy for `migration` if you want manual control while
   we iterate; otherwise leave it on so every push to `migration/next`
   triggers a preview build.

---

## 2. Provision Postgres (Railway plugin)

1. In the `migration` environment, click **+ New** → **Database** →
   **Add PostgreSQL**.
2. Railway auto-creates a `Postgres` service and exposes these vars to
   linked services in the same environment:
   - `DATABASE_URL`
   - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
3. Link the Next.js service to the Postgres service (Railway prompts for
   this on first connect, or do it manually under **Service → Variables
   → Reference**).
4. Confirm `DATABASE_URL` shows up under the Next.js service's variables
   tab — Prisma reads it at build + runtime.

> **Do NOT** add Postgres to the `production` environment yet. The
> vanilla JS server still uses JSON files in the `data-runtime/`
> Railway Volume; mixing storage layers before cutover is asking for
> bugs.

---

## 3. Required env vars on the `migration` environment

Set these in **Service → Variables** for the Next.js service in the
`migration` environment. All are documented in `.env.example`.

| Variable | Source / Value | Notes |
|---|---|---|
| `DATABASE_URL` | Auto from Postgres plugin | Reference, don't hardcode |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | New value, do not reuse prod |
| `BASE_URL` | Railway-provided preview URL | e.g. `https://nautical-nick-migration.up.railway.app` |
| `STRIPE_SECRET_KEY` | Stripe **test mode** secret key | `sk_test_...` |
| `STRIPE_PRICE_ID_MONTHLY` | Stripe test-mode monthly price ID | `price_test_...` |
| `STRIPE_PRICE_ID_ANNUAL` | Stripe test-mode annual price ID | `price_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe test-mode webhook signing secret | `whsec_test_...` |
| `RESEND_API_KEY` | Resend API key (can reuse prod) | Sandbox/test domain preferred |
| `FROM_EMAIL` | Verified Resend sender | OK to reuse |
| `ANTHROPIC_API_KEY` | Anthropic console key | Reuse prod, but cron is GitHub Actions, not Railway |
| `NASA_EARTHDATA_USER` / `NASA_EARTHDATA_PASS` | Reuse prod | GitHub Actions only |

### Stripe test-mode setup
1. Stripe dashboard → toggle **Test mode** (top-right).
2. **Products** → recreate the Premium product with Monthly + Annual
   recurring prices. Capture both price IDs.
3. **Developers → Webhooks** → add endpoint pointing at
   `{BASE_URL}/api/stripe-webhook`. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (starts with `whsec_`) into
   `STRIPE_WEBHOOK_SECRET`.

---

## 4. `railway.json` handling during the migration window

**Do not edit `railway.json` on `main`.** The current file pins
`startCommand: "node api/server.js"` which the production deploy
depends on.

On the `migration/next` branch, when Phase 4/5 work is ready:
- Update `railway.json` to `startCommand: "npm run start"` (which now
  resolves to `next start`).
- Add `buildCommand: "npm run build && npx prisma generate"` so the
  build step generates the Prisma client and compiles Next.

For Phase 0, leave `railway.json` untouched. The Railway `migration`
environment can either:
- (a) inherit `railway.json` from the branch (will fail to start until
  Phase 4 — that's fine, no users hit it), or
- (b) get an environment-level **Start Command** override in the dashboard
  pointing at `npm run start` once Frontend lands an `app/` skeleton.

Recommend (b) for early iteration; switch to (a) once the file change
is safe to commit.

---

## 5. Volume mounts

- **Production** Railway environment: keep the existing volume mounted
  at `/data` (used by `data-runtime/`). Do not detach.
- **Migration** Railway environment: no volume needed. All mutable
  state lives in Postgres.

---

## 6. Smoke test (after Frontend lands `app/` skeleton)

1. Push to `migration/next`.
2. Wait for Railway build to complete in the `migration` environment.
3. Visit the Railway-assigned preview URL.
4. Hit `GET /api/health` → expect `{ "status": "ok", ... }` (Backend
   adds this route in Phase 1).
5. Confirm `DATABASE_URL` is reachable from the running container by
   running `npx prisma migrate status` via Railway's shell.

---

## 7. Rollback plan for Phase 0

If anything in this checklist breaks production:
1. Production runs from `main`, so it cannot be affected by anything
   on the `migration` environment unless someone manually edited the
   production environment's variables. Audit those first.
2. If `railway.json` was accidentally committed to `main`, revert via:
   ```bash
   git revert <sha>
   git push origin main
   ```
3. The `migration` environment can be deleted entirely from the
   Railway dashboard with no impact on production.

---

## 8. Sign-off checklist

- [ ] `migration` environment created in Railway
- [ ] Postgres plugin attached and `DATABASE_URL` exposed
- [ ] All env vars from §3 set
- [ ] Stripe test-mode webhook endpoint created
- [ ] Production environment untouched (verify by checking `main`'s
      latest deploy is still green)
