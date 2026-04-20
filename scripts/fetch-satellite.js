/**
 * fetch-satellite.js
 *
 * Fetches NOAA CoastWatch ERDDAP satellite chlorophyll data for every spot
 * in data/regions.json, plus a regional aggregate at each region's centerCoords.
 *
 * Dataset: erdMH1chla1day  (MODIS Aqua, 1-day composite)
 * ERDDAP uses 0–360 longitude, so -117.27 → 242.73.
 *
 * Writes:
 *   • sources.satellite on each region (using centerCoords)
 *   • spots[slug].chlorophyll on each region
 *   • lastUpdated timestamp
 *
 * Usage: node scripts/fetch-satellite.js
 */

require('dotenv').config();

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

const REGIONS_JSON    = path.join(__dirname, '..', 'data', 'regions.json');
const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');

const ERDDAP_BASE = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap';
const DATASET    = 'erdMH1chla1day';

// Throttle outbound ERDDAP requests — don't hammer their server.
const REQUEST_DELAY_MS = 350;

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const regions = JSON.parse(fs.readFileSync(REGIONS_JSON, 'utf8')).regions;
  const conditions = loadConditions();

  console.log(`[satellite] Fetching chlorophyll for ${regions.length} regions…`);

  for (const region of regions) {
    console.log(`\n[satellite] Region: ${region.displayName}`);

    // Regional aggregate (uses centerCoords)
    const center = await fetchChlorophyll(region.centerCoords.lat, region.centerCoords.lon);
    upsertRegion(conditions, region.slug);
    conditions.regions[region.slug].sources = conditions.regions[region.slug].sources || {};
    conditions.regions[region.slug].sources.satellite = {
      chlorophyll: center.chlorophyll,
      unit:        'mg/m³',
      note:        chlorophyllNote(center.chlorophyll),
      timestamp:   center.timestamp,
    };
    console.log(`  · center chlorophyll: ${center.chlorophyll} mg/m³`);

    // Per-spot readings
    conditions.regions[region.slug].spots = conditions.regions[region.slug].spots || {};
    for (const spot of region.spots) {
      await sleep(REQUEST_DELAY_MS);
      const r = await fetchChlorophyll(spot.coords.lat, spot.coords.lon);
      const existing = conditions.regions[region.slug].spots[spot.slug] || {};
      conditions.regions[region.slug].spots[spot.slug] = {
        ...existing,
        chlorophyll: r.chlorophyll,
      };
      console.log(`  · ${spot.slug}: ${r.chlorophyll ?? '—'} mg/m³`);
    }
  }

  conditions.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(conditions, null, 2));
  console.log('\n[satellite] conditions.json updated.');
}

// ── helpers ──────────────────────────────────────────────────────────────
async function fetchChlorophyll(lat, lonSigned) {
  // Convert -180..180 to 0..360 as ERDDAP expects
  const lon = lonSigned < 0 ? 360 + lonSigned : lonSigned;
  const url = `${ERDDAP_BASE}/${DATASET}.json?chlorophyll%5B(last)%5D%5B(${lat})%5D%5B(${lon})%5D`;

  try {
    const res  = await axios.get(url, { timeout: 20_000 });
    const rows = res.data && res.data.table && res.data.table.rows;

    if (rows && rows.length > 0) {
      const cols   = res.data.table.columnNames;
      const chlIdx = cols.indexOf('chlorophyll');
      const tIdx   = cols.indexOf('time');
      const chl    = parseFloat(rows[0][chlIdx]);

      return {
        chlorophyll: isNaN(chl) ? null : Math.round(chl * 100) / 100,
        timestamp:   rows[0][tIdx] || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.warn(`  · ERDDAP fetch failed for ${lat},${lonSigned}: ${err.message}`);
  }

  return { chlorophyll: null, timestamp: new Date().toISOString() };
}

function chlorophyllNote(val) {
  if (val == null || isNaN(val)) return 'Satellite reading unavailable.';
  if (val < 0.3)  return 'Very low chlorophyll — clean oceanic water pushing inshore. Exceptional clarity likely.';
  if (val < 0.6)  return 'Low chlorophyll — minimal phytoplankton bloom. Good to excellent visibility expected.';
  if (val < 1.2)  return 'Moderate chlorophyll — some phytoplankton present. Visibility may be reduced.';
  if (val < 3.0)  return 'Elevated chlorophyll — active bloom conditions. Expect reduced visibility.';
  return 'High chlorophyll — significant bloom in progress. Poor visibility likely inshore.';
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

main().catch(err => { console.error('[satellite] Fatal:', err); process.exit(1); });
