---
name: add-beach
description: Add a new beach/dive spot to the system end-to-end. Inserts the location into the database, wires it into the data pipeline, generates a landing page, adds SEO metadata, updates the sitemap, and writes a basic test. Coordinates work across Backend, Ocean Data, and Frontend agents.
---

# Add Beach

Adds a new dive spot to Nautical Nick end-to-end. Multi-agent coordination — route through Project Manager.

## Inputs Required

Ask the user for:
1. **Name** (e.g., "Wreck Alley")
2. **Coordinates** (lat, lon — get these from Google Maps if user only gives a name)
3. **Region** (San Diego, Orange County, LA, Catalina)
4. **Max depth** (feet)
5. **Type** (beach / reef / bay / harbor / cove)
6. **Hero photo URL** (optional — fallback emoji is fine)

## Steps (route to agents)

### 1. Backend — insert location row
```sql
insert into locations (name, slug, lat, lon, region, max_depth_ft, type, hero_image_url)
values (...);
```
Backend confirms row inserted, returns the new `slug`.

### 2. Ocean Data — verify pipeline picks up the new spot
- Confirm fetchers iterate `locations` and don't have hardcoded spot lists
- If hardcoded anywhere (legacy code), update to query `locations` table
- Run a manual fetch for the new spot to seed initial data:
  - `npm run satellite -- --spot=<slug>`
  - `npm run surf -- --spot=<slug>`
  - `npm run weather -- --spot=<slug>`

### 3. Visibility Reporter — generate first forecast
- Run `npm run forecast -- --spot=<slug>` to produce the initial cached forecast
- Verify a row appears in `forecasts` table

### 4. Frontend — landing page + SEO
- Confirm dynamic route `app/spots/[slug]/page.tsx` renders the new spot (no hardcoded routes needed if dynamic)
- Verify hero photo displays (or emoji fallback)
- Add to sitemap: `app/sitemap.ts` should pull from `locations` automatically
- Verify Open Graph + meta tags render with the spot's name + region
- Take `mcp__Claude_Preview__preview_screenshot` of the new page (mobile + desktop)

### 5. Test
- Frontend: snapshot test that the new slug renders without error
- Ocean Data: fetcher test confirms the new spot appears in iteration

### 6. Verify
- Visit `https://nauticalnick.net/spots/<slug>` (after deploy)
- Confirm: hero, vis number, factor chips, gated tiles for free user, all gated content for Pro user

## Output

A summary listing:
- New `slug`
- Tables touched (locations, conditions, satellite_data, …, forecasts)
- Scripts run with their output row counts
- URL of the new live page
- Screenshots
