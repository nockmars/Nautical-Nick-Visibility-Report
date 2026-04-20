/**
 * fetch-surf.js
 *
 * Fetches free surf/swell/wind conditions for every spot in regions.json.
 *
 * Sources (both free, no API key):
 *   • Open-Meteo Marine API    — swell height, period, direction
 *     https://marine-api.open-meteo.com/v1/marine
 *   • Open-Meteo Weather API   — wind speed, wind direction
 *     https://api.open-meteo.com/v1/forecast
 *
 * Writes:
 *   • sources.surf (regional aggregate at centerCoords)
 *   • spots[slug].waveHeightFt, spots[slug].windKts (per-spot)
 *
 * Usage: node scripts/fetch-surf.js
 */

require('dotenv').config();

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

const REGIONS_JSON    = path.join(__dirname, '..', 'data', 'regions.json');
const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');

const MARINE_BASE  = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

const REQUEST_DELAY_MS = 250; // play nice with the free API

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const regions    = JSON.parse(fs.readFileSync(REGIONS_JSON, 'utf8')).regions;
  const conditions = loadConditions();

  console.log(`[surf] Fetching swell + wind for ${regions.length} regions…`);

  for (const region of regions) {
    console.log(`\n[surf] Region: ${region.displayName}`);

    // Aggregate at region center
    const center = await fetchAllConditions(region.centerCoords.lat, region.centerCoords.lon);
    upsertRegion(conditions, region.slug);
    conditions.regions[region.slug].sources = conditions.regions[region.slug].sources || {};
    conditions.regions[region.slug].sources.surf = {
      waveHeightFt: center.waveHeightFt,
      periodSec:    center.periodSec,
      direction:    center.swellDir,
      windKts:      center.windKts,
      windDir:      center.windDir,
      note:         surfNote(center),
      timestamp:    center.timestamp,
    };
    console.log(`  · center: ${center.waveHeightFt}ft @ ${center.periodSec}s, wind ${center.windKts}kts ${center.windDir}`);

    // Per-spot
    conditions.regions[region.slug].spots = conditions.regions[region.slug].spots || {};
    for (const spot of region.spots) {
      await sleep(REQUEST_DELAY_MS);
      const r = await fetchAllConditions(spot.coords.lat, spot.coords.lon);
      const existing = conditions.regions[region.slug].spots[spot.slug] || {};
      conditions.regions[region.slug].spots[spot.slug] = {
        ...existing,
        waveHeightFt: r.waveHeightFt,
        windKts:      r.windKts,
      };
      console.log(`  · ${spot.slug}: ${r.waveHeightFt ?? '—'}ft swell, ${r.windKts ?? '—'}kts wind`);
    }
  }

  conditions.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(conditions, null, 2));
  console.log('\n[surf] conditions.json updated.');
}

// ── fetchers ─────────────────────────────────────────────────────────────
async function fetchAllConditions(lat, lon) {
  const [marine, weather] = await Promise.all([
    fetchMarine(lat, lon),
    fetchWeather(lat, lon),
  ]);

  return {
    waveHeightFt: marine.waveHeightFt,
    periodSec:    marine.periodSec,
    swellDir:     marine.swellDir,
    windKts:      weather.windKts,
    windDir:      weather.windDir,
    timestamp:    new Date().toISOString(),
  };
}

async function fetchMarine(lat, lon) {
  const url = `${MARINE_BASE}?latitude=${lat}&longitude=${lon}` +
              `&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction` +
              `&length_unit=imperial&timezone=America%2FLos_Angeles`;

  try {
    const res = await axios.get(url, { timeout: 15_000 });
    const c = res.data && res.data.current;
    if (!c) return emptyMarine();

    // Prefer swell over combined wave when available
    const ht  = c.swell_wave_height ?? c.wave_height;
    const per = c.swell_wave_period ?? c.wave_period;
    const dir = c.swell_wave_direction ?? c.wave_direction;

    return {
      waveHeightFt: ht != null ? Math.round(ht * 10) / 10 : null,
      periodSec:    per != null ? Math.round(per) : null,
      swellDir:     degToCompass(dir),
    };
  } catch (err) {
    console.warn(`  · marine fetch failed for ${lat},${lon}: ${err.message}`);
    return emptyMarine();
  }
}

async function fetchWeather(lat, lon) {
  const url = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}` +
              `&current=wind_speed_10m,wind_direction_10m` +
              `&wind_speed_unit=kn&timezone=America%2FLos_Angeles`;

  try {
    const res = await axios.get(url, { timeout: 15_000 });
    const c = res.data && res.data.current;
    if (!c) return emptyWeather();

    return {
      windKts: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : null,
      windDir: degToCompass(c.wind_direction_10m),
    };
  } catch (err) {
    console.warn(`  · weather fetch failed for ${lat},${lon}: ${err.message}`);
    return emptyWeather();
  }
}

function emptyMarine()  { return { waveHeightFt: null, periodSec: null, swellDir: null }; }
function emptyWeather() { return { windKts: null, windDir: null }; }

// ── helpers ──────────────────────────────────────────────────────────────
function degToCompass(deg) {
  if (deg == null || isNaN(deg)) return null;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function surfNote(c) {
  if (c.waveHeightFt == null) return 'Surf data unavailable.';

  const parts = [];
  if (c.waveHeightFt < 2)        parts.push('Small, glassy swell');
  else if (c.waveHeightFt < 4)   parts.push('Moderate swell');
  else if (c.waveHeightFt < 6)   parts.push('Solid swell');
  else                           parts.push('Large swell — expect surge');

  if (c.periodSec != null) {
    if (c.periodSec >= 14)      parts.push(`long-period (${c.periodSec}s) — cleaner water push`);
    else if (c.periodSec >= 10) parts.push(`mid-period (${c.periodSec}s)`);
    else                        parts.push(`short-period (${c.periodSec}s) — chop likely`);
  }

  if (c.windKts != null) {
    if (c.windKts < 6)       parts.push(`light ${c.windDir || ''} wind`);
    else if (c.windKts < 12) parts.push(`moderate ${c.windDir || ''} wind`);
    else                     parts.push(`strong ${c.windDir || ''} wind — surface chop`);
  }

  return parts.join(', ').trim() + '.';
}

function loadConditions() {
  if (!fs.existsSync(CONDITIONS_JSON)) return { regions: {} };
  try { return JSON.parse(fs.readFileSync(CONDITIONS_JSON, 'utf8')); }
  catch { return { regions: {} }; }
}

function upsertRegion(conditions, slug) {
  conditions.regions = conditions.regions || {};
  conditions.regions[slug] = conditions.regions[slug] || {};
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('[surf] Fatal:', err); process.exit(1); });
