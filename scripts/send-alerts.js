/**
 * send-alerts.js
 *
 * Walks every stored email alert and sends a Resend email to subscribers
 * whose visibility threshold has been met for their chosen region.
 *
 * Alerts fire at most once per day per (email, region) pair (tracked via
 * lastSentDate in data/alerts.json).
 *
 * Environment variables required:
 *   RESEND_API_KEY
 *   FROM_EMAIL        — e.g. "alerts@nauticalnick.net" (must be a domain
 *                        you've verified in Resend)
 *   BASE_URL          — e.g. "https://nauticalnick.net"
 */

require('dotenv').config();

const path   = require('path');
const fs     = require('fs');
const { Resend } = require('resend');

const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');
const ALERTS_JSON     = path.join(__dirname, '..', 'data', 'alerts.json');
const REGIONS_JSON    = path.join(__dirname, '..', 'data', 'regions.json');

const BASE_URL  = process.env.BASE_URL  || 'https://nauticalnick.net';
const FROM      = `Nautical Nick <${process.env.FROM_EMAIL || 'alerts@nauticalnick.net'}>`;

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[alerts] RESEND_API_KEY not set, skipping.');
    return;
  }

  const resend     = new Resend(process.env.RESEND_API_KEY);
  const conditions = loadJSON(CONDITIONS_JSON);
  const alertsData = loadJSON(ALERTS_JSON) || { alerts: [] };
  const regions    = loadJSON(REGIONS_JSON) || { regions: [] };

  if (!conditions || !conditions.regions) {
    console.log('[alerts] No conditions data, skipping.');
    return;
  }

  const today = todayPacific();
  let sentCount = 0;
  const updatedAlerts = [];

  for (const alert of alertsData.alerts || []) {
    // Skip if already sent today for this region
    if (alert.lastSentDate === today) {
      updatedAlerts.push(alert);
      continue;
    }

    const regionCond = conditions.regions[alert.region];
    const feet       = regionCond && regionCond.visibility && regionCond.visibility.feet;

    if (feet == null) {
      updatedAlerts.push(alert);
      continue;
    }

    if (feet < alert.threshold) {
      updatedAlerts.push(alert);
      continue;
    }

    // Threshold met — send
    try {
      await resend.emails.send({
        from:    FROM,
        to:      alert.email,
        subject: `🌊 ${prettyRegion(alert.region)} visibility is ${feet}ft — get in the water`,
        html:    buildEmailHtml(alert, regionCond, regions),
      });
      console.log(`[alerts] Sent to ${mask(alert.email)} — ${alert.region} ${feet}ft (>= ${alert.threshold}ft)`);
      sentCount++;
      updatedAlerts.push({ ...alert, lastSentDate: today });
    } catch (err) {
      console.error(`[alerts] Failed to send to ${mask(alert.email)}:`, err.message);
      updatedAlerts.push(alert);
    }
  }

  alertsData.alerts = updatedAlerts;
  fs.writeFileSync(ALERTS_JSON, JSON.stringify(alertsData, null, 2));
  console.log(`[alerts] Done. Sent ${sentCount} email(s).`);
}

// ── Email body ───────────────────────────────────────────────────────────
function buildEmailHtml(alert, regionCond, regions) {
  const feet    = regionCond.visibility.feet;
  const rating  = regionCond.visibility.rating || 'GOOD';
  const note    = regionCond.visibility.note   || '';
  const summary = regionCond.aiSummary || '';

  // Top 3 spots for this region by visibility
  const regionMeta = regions.regions.find(r => r.slug === alert.region);
  const spotEntries = regionMeta && regionMeta.spots ? regionMeta.spots.map(s => {
    const reading = (regionCond.spots && regionCond.spots[s.slug]) || {};
    return { name: s.name, vis: reading.visibility };
  }).filter(s => s.vis != null) : [];

  spotEntries.sort((a, b) => b.vis - a.vis);
  const top3 = spotEntries.slice(0, 3);

  const spotRows = top3.map(s => `
    <tr>
      <td style="padding:6px 12px;font-family:-apple-system,sans-serif;color:#0d3347;">${s.name}</td>
      <td style="padding:6px 12px;font-family:-apple-system,sans-serif;color:#00a0b8;font-weight:600;text-align:right;">${s.vis} ft</td>
    </tr>
  `).join('');

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f9fb;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #d7e8ef;">

      <div style="background:#0a2a3a;color:#00e5ff;padding:22px 24px;">
        <div style="font-size:12px;letter-spacing:0.2em;opacity:0.75;">NAUTICAL NICK VISIBILITY REPORT</div>
        <div style="font-size:26px;font-weight:700;margin-top:4px;">${prettyRegion(alert.region)}: ${feet}ft — ${rating}</div>
      </div>

      <div style="padding:22px 24px;color:#0d3347;">
        <p style="margin:0 0 10px;font-size:15px;">Your <strong>${alert.threshold}ft</strong> threshold has been met.</p>
        <p style="margin:0 0 16px;color:#3c5e6e;font-size:14px;line-height:1.5;">${note}</p>

        ${top3.length ? `
        <div style="border-top:1px solid #e1edf2;padding-top:14px;margin-top:14px;">
          <div style="font-size:12px;letter-spacing:0.15em;color:#6a9ab0;margin-bottom:8px;">TOP SPOTS TODAY</div>
          <table style="width:100%;border-collapse:collapse;">${spotRows}</table>
        </div>` : ''}

        ${summary ? `
        <div style="background:#f4f9fb;border-left:3px solid #00a0b8;padding:12px 14px;margin-top:18px;font-size:13px;color:#3c5e6e;line-height:1.5;">
          ${escapeHtml(summary)}
        </div>` : ''}

        <div style="margin-top:22px;text-align:center;">
          <a href="${BASE_URL}"
             style="display:inline-block;background:#00a0b8;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600;letter-spacing:0.03em;">
            View full report
          </a>
        </div>
      </div>

      <div style="background:#f4f9fb;padding:14px 24px;font-size:11px;color:#6a9ab0;text-align:center;">
        One email max per day per region. &nbsp;·&nbsp;
        <a href="${BASE_URL}" style="color:#6a9ab0;">Manage alerts</a>
      </div>

    </div>
  </div>`;
}

// ── helpers ──────────────────────────────────────────────────────────────
function prettyRegion(slug) {
  const map = {
    'san-diego':       'San Diego',
    'orange-county':   'Orange County',
    'la-county':       'Los Angeles County',
    'catalina-island': 'Catalina Island',
  };
  return map[slug] || slug;
}

function mask(email) {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const masked = name.slice(0, 2) + '***';
  return `${masked}@${domain}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch { return null; }
}

function todayPacific() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

main().catch(err => { console.error('[alerts] Fatal:', err); process.exit(1); });
