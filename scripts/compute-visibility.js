/**
 * compute-visibility.js
 *
 * Reads all fetched sources from conditions.json and computes a single
 * visibility estimate (feet) per spot + range + confidence + contributing
 * factors. Writes back into conditions.json under each spot.
 *
 * Must run AFTER: fetch-satellite.js, fetch-surf.js, fetch-weather.js
 *
 * Algorithm:
 *   1. Chlorophyll → baseline visibility (log-scale mapping)
 *   2. Apply swell penalty (wave height)
 *   3. Apply wind penalty (stirs surface + surface chop)
 *   4. Apply rain penalty (5-day history × location-type multiplier)
 *   5. Clamp to 3–40 ft realistic range
 *   6. Compute range (±uncertainty based on confidence)
 *   7. Compute confidence tier (High / Medium / Low)
 *   8. Build factor list (for UI display)
 *
 * Usage: node scripts/compute-visibility.js
 */

require('dotenv').config();

const path = require('path');
const fs   = require('fs');

const REGIONS_JSON    = path.join(__dirname, '..', 'data', 'regions.json');
const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  const regions    = JSON.parse(fs.readFileSync(REGIONS_JSON, 'utf8')).regions;
  const conditions = JSON.parse(fs.readFileSync(CONDITIONS_JSON, 'utf8'));

  console.log(`[compute-vis] Computing visibility for ${regions.length} regions…`);

  for (const region of regions) {
    console.log(`\n[compute-vis] ${region.displayName}`);
    const regionData = conditions.regions[region.slug];
    if (!regionData || !regionData.spots) continue;

    // Region-level (centerCoords aggregate)
    const regionResult = computeForLocation({
      chl:           regionData.sources?.satellite?.chlorophyll,
      waveHeightFt:  regionData.sources?.surf?.waveHeightFt,
      windKts:       regionData.sources?.surf?.windKts,
      rainHistory:   regionData.sources?.weather?.rainHistory || [],
      locationType:  'coastal', // region-level aggregate uses coastal multiplier
      weatherCond:   regionData.sources?.weather?.condition,
    });
    regionData.visibility       = regionResult.visibility;
    regionData.visibilityRange  = regionResult.range;
    regionData.visibilityConfidence = regionResult.confidence;
    regionData.visibilityFactors = regionResult.factors;
    console.log(`  · region aggregate: ${regionResult.visibility}ft (${regionResult.range.low}-${regionResult.range.high}) conf=${regionResult.confidence}`);

    // Per-spot
    for (const spot of region.spots) {
      const spotData = regionData.spots[spot.slug] || {};
      const result = computeForLocation({
        chl:           spotData.chlorophyll,
        waveHeightFt:  spotData.waveHeightFt,
        windKts:       spotData.windKts,
        rainHistory:   spotData.rainHistory || regionData.sources?.weather?.rainHistory || [],
        locationType:  spot.type || 'coastal',
        weatherCond:   spotData.weather?.condition,
      });
      spotData.visibility           = result.visibility;
      spotData.visibilityRange      = result.range;
      spotData.visibilityConfidence = result.confidence;
      spotData.visibilityFactors    = result.factors;
      regionData.spots[spot.slug]   = spotData;
      console.log(`  · ${spot.slug}: ${result.visibility}ft (${result.range.low}-${result.range.high}) ${result.confidence}`);
    }
  }

  conditions.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(conditions, null, 2));
  console.log('\n[compute-vis] conditions.json updated.');
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════
function computeForLocation({ chl, waveHeightFt, windKts, rainHistory, locationType, weatherCond }) {
  const factors = [];

  // 1) BASELINE FROM CHLOROPHYLL
  // Formula: vis_ft = clamp(30 - 20*log10(chl/0.3), 3, 40)
  //   chl 0.1 → ~40 ft (exceptional)
  //   chl 0.3 → 30 ft (clean)
  //   chl 1.2 → 18 ft (moderate)
  //   chl 3.0 → 10 ft (poor)
  let baseline;
  let chlKnown = chl != null && !isNaN(chl) && chl > 0;
  if (chlKnown) {
    baseline = clamp(30 - 20 * Math.log10(chl / 0.3), 3, 40);
    factors.push({
      label:    chlorophyllLabel(chl),
      value:    `${chl} mg/m³`,
      impact:   chl < 0.6 ? 'positive' : chl < 1.5 ? 'neutral' : 'negative',
      severity: chl < 0.3 ? 'large' : chl < 1.5 ? 'medium' : 'large',
      reasoning: 'Chlorophyll is a proxy for phytoplankton density — higher levels scatter light and reduce visibility.',
    });
  } else {
    // No chlorophyll → assume moderate default (region-average conditions)
    baseline = 18;
    factors.push({
      label:    'Chlorophyll data unavailable',
      value:    '—',
      impact:   'neutral',
      severity: 'small',
      reasoning: 'Using regional baseline estimate.',
    });
  }

  let vis = baseline;

  // 2) SWELL PENALTY
  // Bigger waves → more sediment stirred, more surge, murkier water
  let swellPenalty = 0;
  if (waveHeightFt != null) {
    if      (waveHeightFt < 2) swellPenalty = 0;
    else if (waveHeightFt < 4) swellPenalty = 2;
    else if (waveHeightFt < 6) swellPenalty = 5;
    else if (waveHeightFt < 8) swellPenalty = 8;
    else                       swellPenalty = 12;

    if (swellPenalty > 0) {
      factors.push({
        label:    swellLabel(waveHeightFt),
        value:    `${waveHeightFt}ft swell`,
        impact:   'negative',
        severity: swellPenalty >= 8 ? 'large' : swellPenalty >= 4 ? 'medium' : 'small',
        reasoning: 'Larger swell stirs sand and sediment into the water column.',
      });
    } else {
      factors.push({
        label:    'Small swell',
        value:    `${waveHeightFt}ft`,
        impact:   'positive',
        severity: 'small',
        reasoning: 'Calm seas let sediment settle.',
      });
    }
  }

  // 3) WIND PENALTY
  // Strong onshore wind creates surface chop and mixes shallow water
  let windPenalty = 0;
  if (windKts != null) {
    if      (windKts < 8)  windPenalty = 0;
    else if (windKts < 15) windPenalty = 1;
    else if (windKts < 20) windPenalty = 3;
    else                   windPenalty = 5;

    if (windPenalty > 0) {
      factors.push({
        label:    windLabel(windKts),
        value:    `${windKts} kts`,
        impact:   'negative',
        severity: windPenalty >= 3 ? 'medium' : 'small',
        reasoning: 'Wind creates surface chop and mixes the upper water column.',
      });
    }
  }

  // 4) RAIN PENALTY
  // Sum penalties for each rain event in past 5 days, with location-type multiplier.
  // Harbor/bay locations retain runoff longer → double the recovery window.
  const now = new Date();
  let rainPenalty = 0;
  let worstRainEvent = null;

  const typeMultiplier = locationTypeMultiplier(locationType);

  for (const event of rainHistory) {
    const amount = event.inches;
    if (amount < 0.05) continue; // negligible

    const eventDate = new Date(event.date + 'T12:00:00'); // noon-anchored
    const hoursSince = (now - eventDate) / (1000 * 60 * 60);
    if (hoursSince < 0) continue; // future forecast — skip

    let recoveryHours, maxPen;
    if      (amount < 0.25) { recoveryHours = 48;  maxPen = 3;  }
    else if (amount < 1.00) { recoveryHours = 72;  maxPen = 8;  }
    else                    { recoveryHours = 120; maxPen = 15; }

    recoveryHours *= typeMultiplier;

    if (hoursSince < recoveryHours) {
      const remaining = 1 - (hoursSince / recoveryHours); // 1.0 → 0.0
      const eventPen  = maxPen * remaining;
      rainPenalty += eventPen;
      if (!worstRainEvent || eventPen > worstRainEvent.penalty) {
        worstRainEvent = { event, penalty: eventPen, hoursSince: Math.round(hoursSince) };
      }
    }
  }

  // Cap total rain penalty so multiple small storms don't stack absurdly
  rainPenalty = Math.min(rainPenalty, 20);

  if (rainPenalty > 0.5 && worstRainEvent) {
    factors.push({
      label:    rainLabel(worstRainEvent.event.inches, worstRainEvent.hoursSince, locationType),
      value:    `${worstRainEvent.event.inches}" ${hoursAgoLabel(worstRainEvent.hoursSince)}`,
      impact:   'negative',
      severity: rainPenalty >= 10 ? 'large' : rainPenalty >= 4 ? 'medium' : 'small',
      reasoning: typeMultiplier > 1
        ? `Enclosed ${locationType}s trap runoff longer — recovery takes ${typeMultiplier}× the usual time.`
        : 'Stormwater runoff carries sediment and pollutants into coastal waters.',
    });
  }

  // 5) WEATHER CONDITION NOTES (no numeric penalty, just a factor chip)
  if (weatherCond === 'rain' || weatherCond === 'rain-showers' || weatherCond === 'thunderstorm') {
    factors.push({
      label: 'Active rain',
      value: weatherCond.replace('-', ' '),
      impact: 'negative',
      severity: 'medium',
      reasoning: 'Rain is actively occurring — runoff entering the water right now.',
    });
  }

  // 6) APPLY ALL PENALTIES
  vis = baseline - swellPenalty - windPenalty - rainPenalty;
  vis = clamp(vis, 3, 40);
  vis = Math.round(vis);

  // 7) CONFIDENCE + RANGE
  const confidence = computeConfidence({ chlKnown, waveHeightFt, windKts, rainPenalty });
  const uncertainty = confidence === 'high' ? 2 : confidence === 'medium' ? 4 : 7;
  const range = {
    low:  Math.max(3,  vis - uncertainty),
    high: Math.min(40, vis + uncertainty),
  };

  return { visibility: vis, range, confidence, factors };
}

// ── labels ───────────────────────────────────────────────────────────────
function chlorophyllLabel(chl) {
  if (chl < 0.3) return 'Exceptionally clean water';
  if (chl < 0.6) return 'Clean water';
  if (chl < 1.2) return 'Moderate phytoplankton';
  if (chl < 3.0) return 'Active plankton bloom';
  return 'Heavy bloom conditions';
}

function swellLabel(ft) {
  if (ft < 2) return 'Calm seas';
  if (ft < 4) return 'Moderate swell';
  if (ft < 6) return 'Solid swell';
  if (ft < 8) return 'Large swell';
  return 'Heavy swell';
}

function windLabel(kts) {
  if (kts < 8)  return 'Light wind';
  if (kts < 15) return 'Moderate wind';
  if (kts < 20) return 'Strong wind';
  return 'Gale wind';
}

function rainLabel(inches, hoursSince, locType) {
  const sev = inches < 0.25 ? 'Light' : inches < 1 ? 'Moderate' : 'Heavy';
  const locNote = (locType === 'bay' || locType === 'harbor') ? ' (enclosed location)' : '';
  return `${sev} rain ${hoursAgoLabel(hoursSince)}${locNote}`;
}

function hoursAgoLabel(h) {
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

// ── helpers ──────────────────────────────────────────────────────────────
function locationTypeMultiplier(type) {
  switch ((type || '').toLowerCase()) {
    case 'harbor':
    case 'bay':       return 2.0;
    case 'cove':      return 1.5;
    default:          return 1.0; // beach, reef, coastal
  }
}

function computeConfidence({ chlKnown, waveHeightFt, windKts, rainPenalty }) {
  let missing = 0;
  if (!chlKnown)           missing++;
  if (waveHeightFt == null) missing++;
  if (windKts == null)      missing++;

  const volatile = rainPenalty > 8; // active heavy rain in recent past

  if (missing >= 2 || (missing >= 1 && volatile)) return 'low';
  if (missing >= 1 || volatile)                   return 'medium';
  return 'high';
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

main();
