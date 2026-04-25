/**
 * scripts/fetchers/fetch-satellite.ts
 *
 * Fetches daily chlorophyll-a concentration per location using a 3-source
 * fallback chain. Writes one row to `chlorophyll_data` per location per run.
 *
 * Source chain (in order of preference):
 *   1. NOAA CoastWatch ERDDAP (MODIS Aqua)   — noaa-coastwatch
 *   2. NOAA West Coast ERDDAP (VIIRS NPP)    — noaa-westcoast
 *   3. NASA OceanColor ERDDAP (MODIS)        — nasa-oceancolor
 *   4. Most recent prior DB row              — cached / stale: true
 *   5. Null row                              — unavailable / stale: true
 *
 * ERDDAP uses 0–360 longitude, so -117.27 becomes 242.73.
 *
 * Usage: tsx scripts/fetchers/fetch-satellite.ts
 * Env:   NASA_EARTHDATA_USER, NASA_EARTHDATA_PASS, DATABASE_URL
 */

import 'dotenv/config';
import axios from 'axios';
import { prisma } from '../../lib/db/client';
import type {
  OceanSource,
  ChlorophyllReading,
  FetcherResult,
  ErddapTableResponse,
} from '../../lib/data/types';

const EARTHDATA_USER = process.env.NASA_EARTHDATA_USER ?? '';
const EARTHDATA_PASS = process.env.NASA_EARTHDATA_PASS ?? '';
const hasEarthdata   = !!(EARTHDATA_USER && EARTHDATA_PASS);

// ── Source definitions ────────────────────────────────────────────────────────

interface ErddapSource {
  name: OceanSource;
  base: string;
  dataset: string;
  requiresAuth: boolean;
}

const SOURCES: ErddapSource[] = [
  {
    name: 'noaa-coastwatch',
    base: 'https://coastwatch.pfeg.noaa.gov/erddap/griddap',
    dataset: 'erdMH1chla1day',
    requiresAuth: false,
  },
  {
    name: 'noaa-westcoast',
    base: 'https://coastwatch.noaa.gov/erddap/griddap',
    dataset: 'noaacwNPPVIIRSSQchlaDaily',
    requiresAuth: false,
  },
  {
    name: 'nasa-oceancolor',
    base: 'https://oceandata.sci.gsfc.nasa.gov/erddap/griddap',
    dataset: 'erdMH1chla1day',
    requiresAuth: true,
  },
];

const REQUEST_DELAY_MS  = 350;
const REQUEST_TIMEOUT_MS = 15_000;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('[satellite] Fatal: DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  // Chlorophyll sources (NOAA CoastWatch, NOAA West Coast, NASA OceanColor)
  // only cover San Diego waters. Fetching LA/OC/Catalina locations produces
  // unavailable rows — noise, not signal. Filter to SD only.
  const locations = await prisma.location.findMany({
    where:   { regionId: 'san-diego' },
    orderBy: [{ regionId: 'asc' }, { slug: 'asc' }],
  });

  console.log(`[satellite] Fetching chlorophyll for ${locations.length} SD locations...`);
  console.log(`[satellite] Earthdata auth: ${hasEarthdata ? 'configured' : 'not configured (skipping NASA OceanColor)'}`);

  const stats = { fresh: 0, stale: 0, unknown: 0 };
  const now = new Date();

  for (const location of locations) {
    await sleep(REQUEST_DELAY_MS);

    const result = await fetchWithFallbackChain(location.latitude, location.longitude, location.id);

    await prisma.chlorophyllData.create({
      data: {
        locationId: location.id,
        fetchedAt:  now,
        valueMgM3:  result.data?.valueMgM3 ?? null,
        source:     result.source,
        stale:      result.stale,
        raw:        result.raw !== undefined ? (result.raw as object) : undefined,
      },
    });

    if (result.data?.valueMgM3 == null) stats.unknown++;
    else if (result.stale) stats.stale++;
    else stats.fresh++;

    const valueStr = result.data?.valueMgM3 != null
      ? `${result.data.valueMgM3} mg/m3${result.stale ? ' (STALE)' : ''}`
      : '-- mg/m3 (unavailable)';
    console.log(`  [${location.slug}] ${valueStr} [${result.source}]`);
  }

  console.log(`\n[satellite] Done: ${stats.fresh} fresh, ${stats.stale} stale, ${stats.unknown} unknown.`);
  await prisma.$disconnect();
}

// ── Fallback chain ────────────────────────────────────────────────────────────

/** Exported for unit testing. */
export async function fetchWithFallbackChain(
  lat: number,
  lonSigned: number,
  locationId: string,
): Promise<FetcherResult<ChlorophyllReading>> {
  const fetchedAt = new Date();

  for (const source of SOURCES) {
    if (source.requiresAuth && !hasEarthdata) continue;
    try {
      const reading = await fetchChlorophyll(source, lat, lonSigned);
      if (reading.valueMgM3 != null) {
        return {
          data:      reading,
          source:    source.name,
          stale:     false,
          fetchedAt,
          raw:       { dataset: source.dataset, lat, lon: lonSigned },
        };
      }
    } catch {
      // swallow and fall through to next source
    }
  }

  // All live sources failed — look for a cached prior row
  const prior = await prisma.chlorophyllData.findFirst({
    where:   { locationId, valueMgM3: { not: null } },
    orderBy: { fetchedAt: 'desc' },
  });

  if (prior?.valueMgM3 != null) {
    return {
      data:      { valueMgM3: prior.valueMgM3, dataTimestamp: prior.fetchedAt.toISOString() },
      source:    'cached',
      stale:     true,
      fetchedAt,
      raw:       { cachedFrom: prior.fetchedAt.toISOString() },
    };
  }

  return {
    data:      { valueMgM3: null, dataTimestamp: null },
    source:    'unavailable',
    stale:     true,
    fetchedAt,
  };
}

// ── ERDDAP fetch ──────────────────────────────────────────────────────────────

/** Exported for unit testing. */
export async function fetchChlorophyll(
  source: ErddapSource,
  lat: number,
  lonSigned: number,
): Promise<ChlorophyllReading> {
  // ERDDAP uses 0–360 longitude
  const lon = lonSigned < 0 ? 360 + lonSigned : lonSigned;
  const url  = `${source.base}/${source.dataset}.json` +
               `?chlorophyll%5B(last)%5D%5B(${lat})%5D%5B(${lon})%5D`;

  const config: Parameters<typeof axios.get>[1] = { timeout: REQUEST_TIMEOUT_MS };
  if (source.requiresAuth) {
    config.auth = { username: EARTHDATA_USER, password: EARTHDATA_PASS };
  }

  const res  = await axios.get<ErddapTableResponse>(url, config);
  const rows = res.data?.table?.rows;
  if (!rows || rows.length === 0) return { valueMgM3: null, dataTimestamp: null };

  const cols   = res.data.table!.columnNames;
  const chlIdx = cols.indexOf('chlorophyll');
  const tIdx   = cols.indexOf('time');
  const raw    = rows[0][chlIdx];
  const chl    = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));

  return {
    valueMgM3:     isNaN(chl) ? null : Math.round(chl * 100) / 100,
    dataTimestamp: String(rows[0][tIdx] ?? '') || null,
  };
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('[satellite] Fatal:', err);
  process.exit(1);
});
