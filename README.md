# The Nautical Nick Visibility Report

Daily ocean visibility tracker for San Diego spearfishermen. Synthesizes NOAA/NASA satellite chlorophyll, Scripps Pier Cam screenshots (analyzed by Claude Vision), and JustGetWet dive reports into a single daily briefing.

---

## Quick start (local preview)

```bash
npm install
npm start
# open http://localhost:3000
```

The site loads with the sample data in `data/*.json` so you can preview the full design before wiring up real data sources.

---

## Project structure

```
├── index.html                  # All 7 sections
├── css/style.css               # Full dark-teal aesthetic (grid overlay, starfish, etc.)
├── js/app.js                   # Data loading, Chart.js, paywall, Stripe checkout
├── assets/
│   └── profile.jpg             # ◄── ADD YOUR YOUTUBE PROFILE PHOTO HERE
├── data/
│   ├── conditions.json         # Today's visibility + sources + spots + AI summary
│   ├── snapshots.json          # 3 daily pier cam snapshots
│   ├── history.json            # Last 14 days
│   ├── alerts.json             # SMS alert subscribers
│   └── snapshots/              # Captured pier cam images (created by GitHub Actions)
├── scripts/
│   ├── capture-pier-cam.js     # Puppeteer → screenshot → Claude Vision → snapshots.json
│   ├── fetch-satellite.js      # NOAA CoastWatch ERDDAP chlorophyll
│   ├── scrape-justgetwet.js    # Scrapes justgetwet.com
│   ├── generate-summary.js     # Claude AI synthesizes all 3 sources
│   ├── send-alerts.js          # Twilio SMS dispatcher
│   └── update-all.js           # Runs the full daily pipeline
├── api/server.js               # Express: Stripe checkout + webhook, alerts API
└── .github/workflows/
    ├── capture-7am.yml         # Scheduled 7:00 AM PT pier cam capture
    ├── capture-9am.yml         # Scheduled 9:00 AM PT pier cam capture
    ├── capture-12pm.yml        # Scheduled 12:00 PM PT pier cam capture
    └── daily-update.yml        # Satellite + JustGetWet + AI summary + SMS alerts
```

---

## Setup checklist

### 1. Add your profile photo
Drop your YouTube channel profile picture at `assets/profile.jpg`. It's already clipped to a circle with a cyan ring in the CSS. If the file is missing, the header falls back to "NN" initials automatically.

### 2. Copy `.env.example` → `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `STRIPE_SECRET_KEY` | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_PUBLISHABLE_KEY` | Same page. Paste into `js/app.js` line 7 too. |
| `STRIPE_PRICE_ID` | Create a $4/month recurring price, grab the `price_...` ID |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → add `https://yourdomain.com/api/stripe-webhook` |
| `TWILIO_ACCOUNT_SID` / `AUTH_TOKEN` / `PHONE_NUMBER` | [console.twilio.com](https://console.twilio.com) |
| `ADSENSE_PUBLISHER_ID` | Once AdSense approves your site, uncomment the script tag in `index.html` |

### 3. Wire up GitHub Actions
Push the repo to GitHub, then in **Settings → Secrets and variables → Actions**, add:
- `ANTHROPIC_API_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

The four workflows (`capture-7am`, `capture-9am`, `capture-12pm`, `daily-update`) will start firing automatically.

### 4. Deploy
- **Frontend (static):** GitHub Pages, Netlify, or Vercel point at the repo root.
- **Backend (Stripe + Twilio):** Deploy `api/server.js` on Railway/Render/Fly. Set `BASE_URL` to your frontend domain.
- **Same host shortcut:** Deploy the whole thing on Railway/Render — `api/server.js` serves the static files too, so you only need one host.

---

## Data pipeline

```
 ┌─ 7 AM PT ──────────┐
 │ GitHub Action      │ → Puppeteer screenshots pier cam
 │ capture-7am.yml    │ → Claude Vision identifies visible pilings (4ft, 11ft, 14ft, 30ft)
 │                    │ → Commits to data/snapshots.json
 └────────────────────┘
 ┌─ 9 AM PT ──────────┐
 │ capture-9am.yml    │ (same as above — marked as LATEST on the site)
 └────────────────────┘
 ┌─ 12 PM PT ─────────┐
 │ capture-12pm.yml   │ (same as above)
 └────────────────────┘
 ┌─ 8:30 AM PT ───────┐
 │ daily-update.yml   │ → fetch-satellite.js     (NOAA chlorophyll)
 │                    │ → scrape-justgetwet.js   (latest dive report)
 │                    │ → generate-summary.js    (Claude synthesizes everything)
 │                    │ → send-alerts.js         (Twilio SMS to subscribers)
 └────────────────────┘
```

All data lands in `data/*.json`. The frontend reads those JSON files on page load — no server-side rendering needed for the public view.

---

## Business model

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | Today's visibility, AI summary, pier cam snapshots, ads (Google AdSense) |
| **Premium** | $4/month | Spot-by-spot breakdown, 14-day history chart, SMS alerts, ad-free |

The paywall is client-side (localStorage `nn_sub_token` + `nn_sub_expiry`). After Stripe Checkout success, the user is redirected back with `?session_id=...` which the frontend stores. For production, add a server-side token verification endpoint that queries Stripe's subscription status on each page load.

---

## The pier piling visibility logic

The Scripps Pier underwater cam has four concrete pilings at known distances:

| Piling | Distance |
|---|---|
| Right-front | 4 ft |
| Right-back | 11 ft |
| Back-left | 14 ft |
| Far-left | 30 ft |

Claude Vision is prompted with these distances and returns which pilings are visible. The estimated visibility = distance of the farthest visible piling.

- Only right-front → ~4 ft viz
- Right-front + right-back → ~11 ft viz
- Plus back-left → ~14 ft viz
- All four → 30 ft+ viz (great day)

---

## Customization

- **Colors:** edit the CSS custom properties at the top of `css/style.css` (`--cyan`, `--orange`, `--panel`, etc.)
- **Price point:** change `STRIPE_PRICE_ID` and the modal copy in `index.html`
- **Spots:** edit the `SPOTS` array in `scripts/generate-summary.js` and the grid rendering in `js/app.js`
- **Satellite coords:** La Jolla is hardcoded in `scripts/fetch-satellite.js` (`LAT = 32.85`, `LON = 242.73`)

---

## Credits

- **Satellite:** NOAA CoastWatch ERDDAP (MODIS Aqua chlorophyll)
- **Pier Cam:** Scripps Institution of Oceanography — [coollab.ucsd.edu/pierviz](https://coollab.ucsd.edu/pierviz/)
- **Dive reports:** [justgetwet.com](https://justgetwet.com)
- **AI analysis:** Anthropic Claude (Vision + text synthesis)
- **Fonts:** Russo One + Exo 2 (Google Fonts)

© 2026 Nautical Nick. Not a substitute for dive planning judgment.
