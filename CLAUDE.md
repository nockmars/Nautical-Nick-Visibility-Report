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
