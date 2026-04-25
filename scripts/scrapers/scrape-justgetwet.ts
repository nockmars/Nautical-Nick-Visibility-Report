/**
 * scripts/scrapers/scrape-justgetwet.ts
 *
 * Scrapes the latest San Diego visibility report from justgetwet.com.
 * Merges the result into the Condition.sourceJson for each SD location
 * (does NOT overwrite existing weather signal — deep-merges).
 *
 * Graceful failure: if the scrape errors, logs a warning and exits 0.
 * SD-only: only locations with regionId === 'san-diego' are updated.
 *
 * Usage: tsx scripts/scrapers/scrape-justgetwet.ts
 * Env:   DATABASE_URL
 */

import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../lib/db/client';
import type { JustGetWetResult } from '../../lib/data/types';

// ── Env validation ────────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error('[justgetwet] Fatal: DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

const JGW_URL   = 'https://justgetwet.com/category/san-diego/';
const JGW_ALT   = 'https://justgetwet.com/';
const VIS_REGEX = /(\d{1,2})\s*(?:–|-|to)\s*(\d{1,2})\s*(?:ft|foot|feet)|(\d{1,2})\s*(?:ft|foot|feet)/i;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[justgetwet] Scraping visibility report...');

  let result: JustGetWetResult;
  try {
    result = await scrape();
  } catch (err) {
    console.warn('[justgetwet] Scrape failed gracefully:', (err as Error).message);
    return; // exit 0 — non-critical
  }

  console.log(`[justgetwet] Visibility: ${result.estimatedVisibility ?? '--'}ft — "${result.report.slice(0, 80)}"`);

  // Load only SD locations
  const sdLocations = await prisma.location.findMany({
    where: { regionId: 'san-diego' },
  });

  const now = new Date();

  for (const location of sdLocations) {
    // Find the most recent Condition row for this location so we can merge
    const existing = await prisma.condition.findFirst({
      where:   { locationId: location.id },
      orderBy: { computedAt: 'desc' },
    });

    // Deep-merge: keep existing weather signal, add justgetwet signal
    const existingSource = (existing?.sourceJson ?? {}) as Record<string, unknown>;
    const mergedSource   = {
      ...existingSource,
      justgetwet: {
        estimatedVisibility: result.estimatedVisibility,
        report:              result.report,
        sourceUrl:           result.sourceUrl,
        scrapedAt:           now.toISOString(),
      },
    };

    await prisma.condition.create({
      data: {
        locationId: location.id,
        computedAt: now,
        rain5dIn:   existing?.rain5dIn ?? null,
        sourceJson: mergedSource,
      },
    });
  }

  console.log(`[justgetwet] Condition rows updated for ${sdLocations.length} SD locations.`);
  await prisma.$disconnect();
}

// ── Scrape ────────────────────────────────────────────────────────────────────

async function scrape(): Promise<JustGetWetResult> {
  for (const url of [JGW_URL, JGW_ALT]) {
    try {
      const html   = await fetchHtml(url);
      const result = parseReport(html, url);
      if (result) return result;
    } catch (err) {
      console.warn(`[justgetwet] Failed to fetch ${url}:`, (err as Error).message);
    }
  }

  return {
    estimatedVisibility: null,
    report:    'No recent report found on JustGetWet. Check the site directly for the latest conditions.',
    sourceUrl: JGW_URL,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    timeout: 20_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NauticalNickBot/1.0; +https://nauticalnick.net)',
    },
  });
  return res.data;
}

function parseReport(html: string, sourceUrl: string): JustGetWetResult | null {
  const $ = cheerio.load(html);

  const articles = $('article, .post, .entry, [class*="post"]').toArray();

  for (const el of articles) {
    const text = $(el).text();

    if (!/visib|ft|feet|foot/i.test(text)) continue;

    const match = text.match(VIS_REGEX);
    if (!match) continue;

    let estimatedVisibility: number;
    if (match[1] && match[2]) {
      estimatedVisibility = Math.round((parseInt(match[1]) + parseInt(match[2])) / 2);
    } else {
      estimatedVisibility = parseInt(match[3] ?? match[1] ?? '0');
    }

    const visIdx  = text.search(VIS_REGEX);
    const start   = Math.max(0, visIdx - 80);
    const end     = Math.min(text.length, visIdx + 120);
    const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
    const title   = $(el).find('h1, h2, h3').first().text().trim();

    return {
      estimatedVisibility,
      report:    title ? `${title}: ${excerpt}` : excerpt,
      sourceUrl,
    };
  }

  return null;
}

main().catch(err => {
  // Catch-all for unexpected errors — still exit 0 (non-critical script)
  console.warn('[justgetwet] Unexpected error:', (err as Error).message);
  process.exit(0);
});
