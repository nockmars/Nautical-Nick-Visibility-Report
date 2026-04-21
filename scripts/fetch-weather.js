/**
 * fetch-weather.js
 *
 * Fetches current weather + 5-day precipitation history per spot.
 * The rain history feeds the visibility algorithm (recent rain depresses
 * visibility via runoff).
 *
 * Source: Open-Meteo (free, no API key required)
 *   • Current: temperature, cloud cover, weather code
 *   • History: daily precipitation for past 5 days
 *
 * Writes:
 *   • sources.weather per region (from centerCoords)
 *   • spots[slug].weather per spot
 *   • spots[slug].rainHistory per spot (array of daily totals, most recent last)
 *
 * Usage: node scripts/fetch-weather.js
 */

require('dotenv').config();

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

const REGIONS_JSON    = path.join(__dirname, '..', 'data', 'regions.json');
const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');

const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

// Open-Meteo returns forecast + past data in one call with past_days param.
const PAST_DAYS  = 5;
const REQUEST_DELAY_MS = 200;

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const regions    = JSON.parse(fs.readFileSync(REGIONS_JSON, 'utf8')).regions;
  const conditions = loadConditions();

  console.log(`[weather] Fetching weather + ${PAST_DAYS}-day rain history for ${regions.length} regions…`);

  for (const region of regions) {
    console.log(`\n[weather] Region: ${region.displayName}`);

    // Regional aggregate
    const center = await fetchWeather(region.centerCoords.lat, region.centerCoords.lon);
    upsertRegion(conditions, region.slug);
    conditions.regions[region.slug].sources = conditions.regions[region.slug].sources || {};
    conditions.regions[region.slug].sources.weather = {
      tempF:          center.tempF,
      cloudPct:       center.cloudPct,
      condition:      center.condition,
      rainHistory:    center.rainHistory,
      totalRain5Day:  center.totalRain5Day,
      note:           weatherNote(center),
      timestamp:      new Date().toISOString(),
    };
    console.log(`  · center: ${center.tempF}°F ${center.condition}, 5-day rain: ${center.totalRain5Day.toFixed(2)}"`);

    // Per-spot
    conditions.regions[region.slug].spots = conditions.regions[region.slug].spots || {};
    for (const spot of region.spots) {
      await sleep(REQUEST_DELAY_MS);
      const w = await fetchWeather(spot.coords.lat, spot.coords.lon);
      const existing = conditions.regions[region.slug].spots[spot.slug] || {};
      conditions.regions[region.slug].spots[spot.slug] = {
        ...existing,
        weather: {
          tempF:     w.tempF,
          cloudPct:  w.cloudPct,
          condition: w.condition,
        },
        rainHistory:   w.rainHistory,
        totalRain5Day: w.totalRain5Day,
      };
      console.log(`  · ${spot.slug}: ${w.tempF}°F, 5-day rain ${w.totalRain5Day.toFixed(2)}"`);
    }
  }

  conditions.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(conditions, null, 2));
  console.log('\n[weather] conditions.json updated.');
}

// ── fetcher ──────────────────────────────────────────────────────────────
async function fetchWeather(lat, lon) {
  const url = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}` +
              `&current=temperature_2m,cloud_cover,weather_code` +
              `&daily=precipitation_sum` +
              `&past_days=${PAST_DAYS}&forecast_days=1` +
              `&temperature_unit=fahrenheit&precipitation_unit=inch` +
              `&timezone=America%2FLos_Angeles`;

  try {
    const res = await axios.get(url, { timeout: 15_000 });
    const d   = res.data;

    const tempF    = d.current?.temperature_2m != null ? Math.round(d.current.temperature_2m) : null;
    const cloudPct = d.current?.cloud_cover    != null ? Math.round(d.current.cloud_cover)    : null;
    const code     = d.current?.weather_code;

    // Daily precip for past_days + today; drop today so we only have *past* rain
    const dailyTimes  = d.daily?.time || [];
    const dailyPrecip = d.daily?.precipitation_sum || [];
    const rainHistory = dailyTimes.slice(0, PAST_DAYS).map((date, i) => ({
      date,
      inches: Math.round((dailyPrecip[i] ?? 0) * 100) / 100,
    }));

    const totalRain5Day = rainHistory.reduce((sum, r) => sum + r.inches, 0);

    return {
      tempF,
      cloudPct,
      condition: wmoCodeToCondition(code),
      rainHistory,
      totalRain5Day,
    };
  } catch (err) {
    console.warn(`  · weather fetch failed for ${lat},${lon}: ${err.message}`);
    return {
      tempF: null,
      cloudPct: null,
      condition: null,
      rainHistory: [],
      totalRain5Day: 0,
    };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────
// WMO weather codes → human-readable condition
// https://open-meteo.com/en/docs
function wmoCodeToCondition(code) {
  if (code == null) return null;
  if (code === 0)                          return 'clear';
  if (code >= 1 && code <= 3)              return 'partly-cloudy';
  if (code === 45 || code === 48)          return 'fog';
  if (code >= 51 && code <= 57)            return 'drizzle';
  if (code >= 61 && code <= 65)            return 'rain';
  if (code >= 66 && code <= 67)            return 'freezing-rain';
  if (code >= 71 && code <= 77)            return 'snow';
  if (code >= 80 && code <= 82)            return 'rain-showers';
  if (code >= 85 && code <= 86)            return 'snow-showers';
  if (code >= 95)                          return 'thunderstorm';
  return 'cloudy';
}

function weatherNote(w) {
  if (w.tempF == null) return 'Weather data unavailable.';
  const parts = [`${w.tempF}°F`];
  if (w.condition)             parts.push(w.condition.replace('-', ' '));
  if (w.cloudPct != null)      parts.push(`${w.cloudPct}% clouds`);
  if (w.totalRain5Day > 0.05)  parts.push(`${w.totalRain5Day.toFixed(2)}" rain past 5 days`);
  return parts.join(', ') + '.';
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

main().catch(err => { console.error('[weather] Fatal:', err); process.exit(1); });
