/**
 * lib/data/history-reader.ts
 *
 * Reads data/history.json and exposes typed access to historical
 * visibility data. Used by Visibility Reporter's Phase 5 backfill script
 * to seed the `forecasts` table from accumulated JSON history.
 *
 * The JSON structure (as of 2026-04-24):
 *   {
 *     "regions": {
 *       "<region-slug>": [
 *         { "date": "YYYY-MM-DD", "visibility": number, "rating": string },
 *         ...
 *       ]
 *     }
 *   }
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  date:       string;   // YYYY-MM-DD
  visibility: number;   // feet
  rating:     string;   // POOR | FAIR | GOOD | EXCELLENT | EPIC
  regionSlug: string;   // e.g. 'san-diego'
}

interface HistoryJson {
  regions: Record<string, Array<{ date: string; visibility: number; rating: string }>>;
}

// ── Path ──────────────────────────────────────────────────────────────────────

const HISTORY_PATH = path.join(__dirname, '..', '..', 'data', 'history.json');

// ── Reader ────────────────────────────────────────────────────────────────────

/**
 * Reads data/history.json and returns a flat array of HistoryEntry objects.
 *
 * @param locationSlug - Optional region slug to filter by (e.g. 'san-diego').
 *                       If omitted, all regions are returned.
 * @returns Array of HistoryEntry sorted by date descending within each region.
 */
export function readHistory(locationSlug?: string): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_PATH)) {
    console.warn('[history-reader] data/history.json not found — returning empty array.');
    return [];
  }

  let parsed: HistoryJson;
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    parsed    = JSON.parse(raw) as HistoryJson;
  } catch (err) {
    console.warn('[history-reader] Failed to parse history.json:', (err as Error).message);
    return [];
  }

  const regions = parsed.regions ?? {};
  const results: HistoryEntry[] = [];

  for (const [regionSlug, entries] of Object.entries(regions)) {
    if (locationSlug && regionSlug !== locationSlug) continue;

    for (const entry of entries) {
      results.push({
        date:       entry.date,
        visibility: entry.visibility,
        rating:     entry.rating,
        regionSlug,
      });
    }
  }

  // Sort descending by date within each region group (stable sort preserves region order)
  results.sort((a, b) => {
    if (a.regionSlug !== b.regionSlug) return 0; // keep region grouping
    return b.date.localeCompare(a.date);
  });

  return results;
}

/**
 * Returns the distinct region slugs present in history.json.
 */
export function readHistoryRegions(): string[] {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    const raw    = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as HistoryJson;
    return Object.keys(parsed.regions ?? {});
  } catch {
    return [];
  }
}
