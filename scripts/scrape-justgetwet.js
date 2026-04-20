/**
 * scrape-justgetwet.js
 *
 * Scrapes the latest San Diego visibility report from justgetwet.com and
 * writes the result into data/conditions.json under sources.justgetwet.
 *
 * JustGetWet posts regular visibility reports for La Jolla / San Diego.
 * This scraper pulls the most recent post mentioning "visibility" and a
 * foot measurement.
 */

require('dotenv').config();

const axios   = require('axios');
const cheerio = require('cheerio');
const path    = require('path');
const fs      = require('fs');

const CONDITIONS_JSON = path.join(__dirname, '..', 'data', 'conditions.json');

// Primary URL — their San Diego dive reports page
const JGW_URL   = 'https://justgetwet.com/category/san-diego/';
const JGW_ALT   = 'https://justgetwet.com/';

const VIS_REGEX = /(\d{1,2})\s*(?:–|-|to)\s*(\d{1,2})\s*(?:ft|foot|feet)|(\d{1,2})\s*(?:ft|foot|feet)/i;

async function main() {
  console.log('[justgetwet] Scraping visibility report…');

  const result = await scrape();
  console.log(`[justgetwet] Visibility: ${result.estimatedVisibility}ft — "${result.report}"`);

  updateConditionsJson(result);
  console.log('[justgetwet] conditions.json updated.');
}

async function scrape() {
  // Try the San Diego category page first
  for (const url of [JGW_URL, JGW_ALT]) {
    try {
      const html = await fetchHtml(url);
      const result = parseReport(html, url);
      if (result) return result;
    } catch (err) {
      console.warn(`[justgetwet] Failed to fetch ${url}:`, err.message);
    }
  }

  return fallback();
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: 20_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NauticalNickBot/1.0; +https://nautical-nick.com)',
    },
  });
  return res.data;
}

function parseReport(html, sourceUrl) {
  const $ = cheerio.load(html);

  // Look for article posts — most recent first
  const articles = $('article, .post, .entry, [class*="post"]').toArray();

  for (const el of articles) {
    const text = $(el).text();

    // Skip posts that don't mention visibility
    if (!/visib|ft|feet|foot/i.test(text)) continue;

    // Find a visibility number
    const match = text.match(VIS_REGEX);
    if (!match) continue;

    let estimatedVisibility;
    if (match[1] && match[2]) {
      // Range like "20–30ft" → use average
      estimatedVisibility = Math.round((parseInt(match[1]) + parseInt(match[2])) / 2);
    } else {
      estimatedVisibility = parseInt(match[3] || match[1]);
    }

    // Pull a short excerpt around the visibility mention
    const visIdx  = text.search(VIS_REGEX);
    const start   = Math.max(0, visIdx - 80);
    const end     = Math.min(text.length, visIdx + 120);
    const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();

    // Try to find the post title
    const title = $(el).find('h1, h2, h3').first().text().trim();

    return {
      estimatedVisibility,
      report: title ? `${title}: ${excerpt}` : excerpt,
      timestamp: new Date().toISOString(),
      sourceUrl,
    };
  }

  return null;
}

function fallback() {
  return {
    estimatedVisibility: null,
    report: 'No recent report found on JustGetWet. Check the site directly for the latest conditions.',
    timestamp: new Date().toISOString(),
    sourceUrl: JGW_URL,
  };
}

function updateConditionsJson(jgw) {
  let data = {};
  if (fs.existsSync(CONDITIONS_JSON)) {
    try { data = JSON.parse(fs.readFileSync(CONDITIONS_JSON, 'utf8')); } catch {}
  }

  if (!data.sources) data.sources = {};
  data.sources.justgetwet = {
    estimatedVisibility: jgw.estimatedVisibility,
    report:    jgw.report,
    timestamp: jgw.timestamp,
    sourceUrl: jgw.sourceUrl,
  };

  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONDITIONS_JSON, JSON.stringify(data, null, 2));
}

main().catch(err => { console.error('[justgetwet] Fatal:', err); process.exit(1); });
