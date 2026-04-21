/**
 * fetch-satellite.js
 *
 * Fetches daily chlorophyll-a concentration per spot using a MULTI-SOURCE
 * fallback chain. The first source that returns a valid reading wins;
 * later sources are skipped. If every live source fails, we fall back to
 * yesterday's stored reading and flag it as stale so the UI can display
 * "showing yesterday's data."
 *
 * Source chain (in order of preference):
 *   1. NOAA CoastWatch ERDDAP — erdMH1chla1day (MODIS Aqua, daily composite)
 *      https://coastwatch.pfeg.noaa.gov
 *      No auth.
 *
 *   2. NOAA West Coast Node ERDDAP — erdVHNchla1day (VIIRS NPP, daily composite)
 *      https://coastwatch.noaa.gov/erddap
 *      No auth. Alternative satellite (VIIRS instead of MODIS) — useful when
 *      one is missing a day.
 *
 *   3. NASA OceanColor ERDDAP — VIIRS or MODIS L3 (same underlying data
 *      NOAA ingests, but direct from NASA).
 *      https://oceandata.sci.gsfc.nasa.gov
 *      Uses Earthdata login via HTTP Basic Auth. Env vars:
 *        NASA_EARTHDATA_USER, NASA_EARTHDATA_PASS
 *
 *   4. Yesterday's stored reading (from conditions.json). Flagged as stale.
 *
 *   5. Null. Algorithm treats as "unknown" and uses regional baseline.
 *
 * ERDDAP uses 0–360 longitude, so -117.27 becomes 242.73.
 *
 * Usage: node scripts/fetch-satellite.js
 */

require('dotenv').config();

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');

const REGIONS_JSON    = path.join(__dirname, '..', 'data', 'regions.json');
const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');

const REQUEST_DELAY_MS = 350;

// NASA Earthdata credentials — must be set in env (Railway + GitHub Actions)
const EARTHDATA_USER = process.env.NASA_EARTHDATA_USER;
const EARTHDATA_PASS = process.env.NASA_EARTHDATA_PASS;
const hasEarthdata   = !!(EARTHDATA_USER && EARTHDATA_PASS);

// Source definitions — tried in order until one returns a valid reading
const SOURCES = [
  {
    name: 'NOAA CoastWatch MODIS',
    base: 'https://coastwatch.pfeg.noaa.gov/erddap/griddap',
    dataset: 'erdMH1chla1day',
    requiresAuth: false,
  },
  {
    name: 'NOAA West Coast VIIRS',
    base: 'https://coastwatch.noaa.gov/erddap/griddap',
    dataset: 'noaacwNPPVIIRSSQchlaDaily',
    requiresAuth: false,
  },
  {
    name: 'NASA OceanColor MODIS',
    base: 'https://oceandata.sci.gsfc.nasa.gov/erddap/griddap',
    dataset: 'erdMH1chla1day',
    requiresAuth: true,
  },
];

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const regions = JSON.parse(fs.readFileSync(REGIONS_JSON, 'utf8')).regions;
  const conditions = loadConditions();

  console.log(`[satellite] Fetching chlorophyll for ${regions.length} regions…`);
  console.log(`[satellite] Earthdata auth: ${hasEarthdata ? '✓ configured' : '✗ not configured (skipping NASA OceanColor)'}`);

  const stats = { fresh: 0, stale: 0, unknown: 0 };

  for (const region of regions) {
    console.log(`\n[satellite] Region: ${region.displayName}`);
    upsertRegion(conditions, region.slug);
    conditions.regions[region.slug].sources = conditions.regions[region.slug].sources || {};
    const prevCenter = conditions.regions[region.slug].sources.satellite;

    // Regional aggregate
    const center = await fetchWithFallbackChain(region.centerCoords.lat, region.centerCoords.lon);
    const centerFinal = applyFallback(center, prevCenter);
    conditions.regions[region.slug].sources.satellite = {
      chlorophyll: centerFinal.chlorophyll,
      unit:        'mg/m³',
      source:      centerFinal.source,
      note:        chlorophyllNote(centerFinal.chlorophyll),
      timestamp:   centerFinal.timestamp,
      stale:       centerFinal.stale,
    };
    updateStats(stats, centerFinal);
    console.log(`  · center: ${formatChl(centerFinal)} [${centerFinal.source}]`);

    // Per-spot
    conditions.regions[region.slug].spots = conditions.regions[region.slug].spots || {};
    for (const spot of region.spots) {
      await sleep(REQUEST_DELAY_MS);
      const prevSpot = conditions.regions[region.slug].spots[spot.slug] || {};
      const r = await fetchWithFallbackChain(spot.coords.lat, spot.coords.lon);
      const rFinal = applyFallback(r, {
        chlorophyll: prevSpot.chlorophyll,
        timestamp:   prevSpot.chlorophyllTimestamp,
      });
      conditions.regions[region.slug].spots[spot.slug] = {
        ...prevSpot,
        chlorophyll:          rFinal.chlorophyll,
        chlorophyllSource:    rFinal.source,
        chlorophyllTimestamp: rFinal.timestamp,
        chlorophyllStale:     rFinal.stale,
      };
      updateStats(stats, rFinal);
      console.log(`  · ${spot.slug}: ${formatChl(rFinal)} [${rFinal.source}]`);
    }
  }

  conditions.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(conditions, null, 2));
  console.log(`\n[satellite] Summary: ${stats.fresh} fresh, ${stats.stale} stale, ${stats.unknown} unknown.`);
  console.log('[satellite] conditions.json updated.');
}

// ── source chain ─────────────────────────────────────────────────────────
async function fetchWithFallbackChain(lat, lonSigned) {
  for (const source of SOURCES) {
    if (source.requiresAuth && !hasEarthdata) continue;
    try {
      const result = await fetchChlorophyll(source, lat, lonSigned);
      if (result.chlorophyll != null) {
        return { ...result, source: source.name };
      }
    } catch (err) {
      // swallow and fall through to next source
    }
  }
  return { chlorophyll: null, timestamp: new Date().toISOString(), source: null };
}

async function fetchChlorophyll(source, lat, lonSigned) {
  const lon = lonSigned < 0 ? 360 + lonSigned : lonSigned;
  const url = `${source.base}/${source.dataset}.json?chlorophyll%5B(last)%5D%5B(${lat})%5D%5B(${lon})%5D`;

  const config = { timeout: 20_000 };
  if (source.requiresAuth) {
    config.auth = { username: EARTHDATA_USER, password: EARTHDATA_PASS };
  }

  const res = await axios.get(url, config);
  const rows = res.data?.table?.rows;
  if (!rows || rows.length === 0) return { chlorophyll: null, timestamp: null };

  const cols   = res.data.table.columnNames;
  const chlIdx = cols.indexOf('chlorophyll');
  const tIdx   = cols.indexOf('time');
  const chl    = parseFloat(rows[0][chlIdx]);

  return {
    chlorophyll: isNaN(chl) ? null : Math.round(chl * 100) / 100,
    timestamp:   rows[0][tIdx] || new Date().toISOString(),
  };
}

// ── fallback + helpers ───────────────────────────────────────────────────
function applyFallback(fresh, prev) {
  if (fresh.chlorophyll != null) {
    return { ...fresh, stale: false };
  }
  if (prev && prev.chlorophyll != null) {
    return {
      chlorophyll: prev.chlorophyll,
      source:      'yesterday (all live sources failed)',
      timestamp:   prev.timestamp || null,
      stale:       true,
    };
  }
  return {
    chlorophyll: null,
    source:      'unavailable',
    timestamp:   fresh.timestamp,
    stale:       false,
  };
}

function updateStats(stats, r) {
  if (r.chlorophyll == null) stats.unknown++;
  else if (r.stale) stats.stale++;
  else stats.fresh++;
}

function formatChl(r) {
  if (r.chlorophyll == null) return '— mg/m³ (unavailable)';
  return `${r.chlorophyll} mg/m³${r.stale ? ' (STALE — using yesterday)' : ''}`;
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
