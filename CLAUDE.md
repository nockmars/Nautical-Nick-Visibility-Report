# Nautical Nick Visibility Report — Claude Context

## Shell
Always use **bash**. Never use PowerShell.

## Tech Stack
- **Frontend**: Vanilla JS, HTML, CSS — no frameworks unless already present in the file being edited
- **Backend**: Node.js + Express (`api/server.js`)
- **Payments**: Stripe
- **Email**: Resend
- **Auth**: Username/password accounts with session cookies; Pro tier gated via server-verified Stripe subscription
- **Deployment**: Railway

## Workflow
1. Before editing, list every file you plan to touch and what changes to each
2. Implement → visually verify with preview tools → commit → push
3. After multi-feature sessions, write a handoff summary before context clears
4. Use `preview_screenshot` after every UI change before marking work done

## Auth Conventions
- Free users see hero info (conditions summary, basic forecast)
- Pro users see all detail tiles (chlorophyll, pier cam, satellite, full data)
- Paywall gate lives server-side; client shows/hides tiles based on `/api/auth/me` response
- Session stored in httpOnly cookie `nn_session`

## Commit Style
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`
- One commit per logical change, not per file
- Message describes the *why*, not the *what*

## Project Structure
- `api/` — Express server, auth endpoints, Stripe webhooks
- `js/` — Frontend JS modules
- `css/` — Styles
- `scripts/` — Data pipeline (chlorophyll, surf, satellite, alerts)
- `data/` — Cached data files
- `assets/` — Static assets

> Note: project is mid-migration to Next.js App Router + Postgres on Railway.
> Post-migration structure will be `app/`, `components/`, `lib/`, `prisma/`, `scripts/`.

## 🚧 Migration Status (read this on session start)

- **Active branch:** `migration/next` (do work here; `main` is untouched live production)
- **Phase 0:** ✅ Complete (2026-04-23). Next.js 15 + Prisma 6 + Tailwind v4 scaffolded, Railway preview live at https://nautical-nick-visibility-report-migration.up.railway.app/
- **Phase 1:** ⏳ Pending — schema design + email/password auth + Stripe test-mode wiring + `/api/health`. Backend agent leads.
- **Resume cue:** When the user says **"resume Phase 1"**, read the latest entry in `CLAUDE_HANDOFF.md` (top of file under today's date) — the "Next Session: Start Here" block has exact steps.
- **Plan doc:** `MIGRATION_PLAN.md` at repo root has full phased plan + locked decisions.

## Agent Team

This project uses `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Five specialized agents live in `.claude/agents/`. Route work through **project-manager** unless the task is obviously single-domain.

| Agent | Model | Domain | DB Write |
|---|---|---|---|
| **project-manager** | Sonnet | Read-only orchestrator. Decomposes tasks, routes via SendMessage, holds context across multi-agent work. | none |
| **frontend** | Sonnet | `app/`, `components/`, `styles/`, `lib/client/`, `hooks/`, `public/`. UI, routing, client state, accessibility. Uses Claude Preview tools for visual verification. | none |
| **backend** | Sonnet | `app/api/`, `lib/db/`, `lib/auth/server*`, `lib/stripe/`, `prisma/`, `.github/workflows/`, `railway.json`, `middleware.ts`. Owns ALL deploy config + schema. | `users`, `sessions`, `subscriptions`, `comments`, `user_preferences`, `password_resets`, `email_verifications`, `locations` |
| **ocean-data** | Sonnet | `scripts/fetchers/`, `scripts/scrapers/`, `scripts/captures/`, `scripts/parsers/`, `lib/data/`. NOAA, NASA, Open-Meteo, JustGetWet, Pier Cam. | `conditions`, `satellite_data`, `weather_data`, `tide_data`, `swell_data`, `chlorophyll_data` |
| **visibility-reporter** | **Opus** | `lib/forecast/`, `lib/alerts/`, `lib/ai/`, `scripts/forecast/`, `scripts/alerts/`. The brain — visibility algorithm, Claude API forecasts + vision. | `forecasts`, `alerts`, `prediction_logs`, `forecast_cache` |

### Hard Rules
- Tool restrictions are enforced via system prompts, not a kernel sandbox. Agents MUST respect their `Forbidden` lists.
- **Caching contract:** Claude API calls happen ONLY in scheduled cron jobs. Per-user-request paths read from the `forecasts` table. Never violate this.
- Schema changes go through Backend. Other agents request via PM.
- Cron schedule changes (`.github/workflows/*.yml`) go through Backend.

### Skills
- `/ship` — test → commit → push → verify Railway deploy → update HANDOFF
- `/handoff` — write structured session handoff to `CLAUDE_HANDOFF.md`
- `/add-beach` — multi-agent end-to-end add of a new dive spot
