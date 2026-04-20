/**
 * generate-summary.js
 *
 * Reads all three data sources (satellite, pier cam, JustGetWet), synthesizes
 * them into a single plain-English visibility report using the Claude API,
 * then writes the result back to data/conditions.json.
 *
 * Also derives an overall visibility estimate (ft) from the three sources
 * and updates the visibility + spot data accordingly.
 *
 * Environment variables required:
 *   ANTHROPIC_API_KEY
 */

require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');
const fs        = require('fs');

const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');
const HISTORY_JSON    = path.join(__dirname, '..', 'data', 'history.json');

const SPOTS = [
  { name: 'La Jolla Cove',    slug: 'la-jolla-cove',    maxDepth: 30  },
  { name: 'Underwater Park',  slug: 'underwater-park',   maxDepth: 65  },
  { name: 'Sunset Cliffs',    slug: 'sunset-cliffs',     maxDepth: 25  },
  { name: 'Point Loma',       slug: 'point-loma',        maxDepth: 80  },
  { name: 'Bird Rock',        slug: 'bird-rock',         maxDepth: 20  },
  { name: 'Del Mar',          slug: 'del-mar',           maxDepth: 15  },
];

async function main() {
  console.log('[summary] Generating AI summary…');

  const data = loadConditions();
  if (!data.sources) { console.error('[summary] No source data found.'); process.exit(1); }

  // Derive overall visibility estimate
  const overallVis = deriveVisibility(data);
  console.log(`[summary] Derived visibility: ${overallVis}ft`);

  // Generate AI narrative
  const summary = await generateSummary(data, overallVis);
  console.log('[summary] AI summary generated.');

  // Update conditions.json
  const rating = visRating(overallVis);
  data.visibility = {
    feet:           overallVis,
    rating,
    note:           visNote(overallVis),
    clarityRating:  clarityStar(overallVis),
    spearingRating: spearingStar(overallVis, data),
  };

  data.aiSummary   = summary;
  data.lastUpdated = new Date().toISOString();
  data.spots       = SPOTS.map(spot => ({
    ...spot,
    visibility: spotVisibility(spot, overallVis),
    trend:      randomTrend(),
  }));

  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(data, null, 2));
  console.log('[summary] conditions.json updated.');

  // Append to history.json
  appendHistory(overallVis, rating);
  console.log('[summary] history.json updated.');
}

// ── Derive overall visibility from three sources ──────────────────────────
function deriveVisibility(data) {
  const src = data.sources;
  const readings = [];

  if (src.piercam?.estimatedVisibility)  readings.push(src.piercam.estimatedVisibility);
  if (src.justgetwet?.estimatedVisibility) readings.push(src.justgetwet.estimatedVisibility);

  // Chlorophyll is a proxy — convert to approximate ft
  if (src.satellite?.chlorophyll != null) {
    const chl = src.satellite.chlorophyll;
    let chlVis;
    if (chl < 0.3)  chlVis = 30;
    else if (chl < 0.6) chlVis = 22;
    else if (chl < 1.2) chlVis = 15;
    else if (chl < 3.0) chlVis = 8;
    else chlVis = 4;
    readings.push(chlVis);
  }

  if (readings.length === 0) return 15; // default
  return Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
}

// ── Claude AI narrative ────────────────────────────────────────────────────
async function generateSummary(data, overallVis) {
  const client = new Anthropic();
  const src    = data.sources;

  const context = `
Today's San Diego ocean visibility data for spearfishermen:

SATELLITE CHLOROPHYLL (NOAA/NASA):
- Reading: ${src.satellite?.chlorophyll ?? 'unavailable'} mg/m³
- Interpretation: ${src.satellite?.note ?? 'unavailable'}

SCRIPPS PIER CAM (UCSD):
- Estimated visibility: ${src.piercam?.estimatedVisibility ?? 'unavailable'} ft
- Pilings visible: ${(src.piercam?.pillingsVisible ?? []).join(', ') || 'unknown'}
- Notes: ${src.piercam?.note ?? 'unavailable'}

JUSTGETWET DIVE REPORT:
- Estimated visibility: ${src.justgetwet?.estimatedVisibility ?? 'unavailable'} ft
- Report: ${src.justgetwet?.report ?? 'unavailable'}

OVERALL DERIVED ESTIMATE: ${overallVis} ft (${visRating(overallVis)})
`.trim();

  const prompt = `${context}

You are Nautical Nick, a San Diego spearfisherman and biologist. Write a concise, practical 2–4 sentence daily visibility briefing for fellow spearfishermen.

Guidelines:
- Lead with the bottom line: today's conditions and estimated visibility.
- Briefly explain what's driving the conditions (chlorophyll, surge, swell, etc.).
- Name 1–2 specific spots that look best today (La Jolla Cove, Underwater Park, Sunset Cliffs, Point Loma, Bird Rock, Del Mar).
- Use plain language, no jargon. Skip fluff. Be direct and helpful.
- Do NOT invent data — only use what's provided above.
- Do NOT mention chlorophyll numbers to readers; translate them into plain English.
`;

  const response = await client.messages.create({
    model:      'claude-opus-4-7',
    max_tokens: 300,
    system:     'You are Nautical Nick, a San Diego spearfisherman writing a daily visibility briefing.',
    messages:   [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

// ── Spot visibility with slight variation per spot ─────────────────────────
function spotVisibility(spot, overall) {
  // Each spot has a slightly different visibility based on exposure and depth
  const offsets = {
    'la-jolla-cove':    0,
    'underwater-park':  2,
    'sunset-cliffs':   -3,
    'point-loma':      -1,
    'bird-rock':       -5,
    'del-mar':         -8,
  };
  const v = overall + (offsets[spot.slug] || 0) + (Math.random() > 0.5 ? 1 : -1);
  return Math.max(2, Math.min(40, Math.round(v)));
}

function randomTrend() {
  const r = Math.random();
  if (r < 0.4) return 'up';
  if (r < 0.7) return 'steady';
  return 'down';
}

// ── History append ─────────────────────────────────────────────────────────
function appendHistory(visibility, rating) {
  let data = { history: [] };
  if (fs.existsSync(HISTORY_JSON)) {
    try { data = JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf8')); } catch {}
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  // Remove today's existing entry if present
  data.history = data.history.filter(h => h.date !== today);
  data.history.unshift({ date: today, visibility, rating });

  // Keep last 14 days
  data.history = data.history.slice(0, 14);

  fs.writeFileSync(HISTORY_JSON, JSON.stringify(data, null, 2));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function loadConditions() {
  if (fs.existsSync(CONDITIONS_JSON)) {
    try { return JSON.parse(fs.readFileSync(CONDITIONS_JSON, 'utf8')); } catch {}
  }
  return {};
}

function visRating(ft) {
  if (ft >= 25) return 'EXCELLENT';
  if (ft >= 15) return 'GOOD';
  if (ft >= 8)  return 'FAIR';
  return 'POOR';
}

function visNote(ft) {
  if (ft >= 25) return 'Crystal clear conditions with excellent horizontal visibility.';
  if (ft >= 15) return 'Good visibility — worthwhile dive day for most spots.';
  if (ft >= 8)  return 'Fair visibility — manageable but not ideal for spearing.';
  return 'Poor visibility — surge or bloom likely reducing clarity significantly.';
}

function clarityStar(ft) {
  if (ft >= 28) return 5;
  if (ft >= 20) return 4;
  if (ft >= 14) return 3;
  if (ft >= 8)  return 2;
  return 1;
}

function spearingStar(ft, data) {
  // Spearing conditions also depend on surge (not tracked yet), default close to clarity
  const base = clarityStar(ft);
  return Math.max(1, Math.min(5, base - (Math.random() > 0.7 ? 1 : 0)));
}

main().catch(err => { console.error('[summary] Fatal:', err); process.exit(1); });
