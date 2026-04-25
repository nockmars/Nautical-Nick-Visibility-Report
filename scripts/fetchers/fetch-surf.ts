/**
 * scripts/fetchers/fetch-surf.ts
 *
 * Fetches swell + wind conditions per location via Open-Meteo (no API key).
 * Writes one row to `swell_data` per location per run.
 *
 * On failure for a location, falls back to the most recent prior swell_data
 * row with stale: true. If no prior row exists, writes a null row with stale: true.
 *
 * Usage: tsx scripts/fetchers/fetch-surf.ts
 * Env:   DATABASE_URL
 */

import 'dotenv/config';
import axios from 'axios';
import { prisma } from '../../lib/db/client';
import type {
  SwellReading,
  FetcherResult,
  OpenMeteoMarineResponse,
  OpenMeteoForecastResponse,
} from '../../lib/data/types';

const MARINE_BASE  = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_DELAY_MS = 250;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('[surf] Fatal: DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const locations = await prisma.location.findMany({
    orderBy: [{ regionId: 'asc' }, { slug: 'asc' }],
  });

  console.log(`[surf] Fetching swell + wind for ${locations.length} locations...`);

  const now = new Date();
  let success = 0;
  let failed  = 0;

  for (const location of locations) {
    await sleep(REQUEST_DELAY_MS);

    const result = await fetchSwellWithFallback(location.latitude, location.longitude, location.id);

    await prisma.swellData.create({
      data: {
        locationId:   location.id,
        fetchedAt:    now,
        waveHeightFt: result.data?.waveHeightFt ?? null,
        periodS:      result.data?.periodS ?? null,
        directionDeg: result.data?.directionDeg ?? null,
        windKts:      result.data?.windKts ?? null,
        windDir:      result.data?.windDir ?? null,
        source:       result.source,
        stale:        result.stale,
      },
    });

    if (result.stale) failed++;
    else success++;

    const wh  = result.data?.waveHeightFt != null ? `${result.data.waveHeightFt}ft` : '--ft';
    const per = result.data?.periodS      != null ? `${result.data.periodS}s`       : '--s';
    const wnd = result.data?.windKts      != null ? `${result.data.windKts}kts`     : '--kts';
    console.log(`  [${location.slug}] ${wh} @ ${per}, wind ${wnd}${result.stale ? ' (STALE)' : ''}`);
  }

  console.log(`\n[surf] Done: ${success} fresh, ${failed} stale.`);
  await prisma.$disconnect();
}

// ── Fetch with fallback ───────────────────────────────────────────────────────

async function fetchSwellWithFallback(
  lat: number,
  lon: number,
  locationId: string,
): Promise<FetcherResult<SwellReading>> {
  const fetchedAt = new Date();

  try {
    const reading = await fetchAllConditions(lat, lon);
    return {
      data:      reading,
      source:    'open-meteo-marine',
      stale:     false,
      fetchedAt,
    };
  } catch (err) {
    console.warn(`  [surf] live fetch failed for ${lat},${lon}:`, (err as Error).message);
  }

  // Fallback to most recent prior row
  const prior = await prisma.swellData.findFirst({
    where:   { locationId },
    orderBy: { fetchedAt: 'desc' },
  });

  if (prior) {
    return {
      data: {
        waveHeightFt: prior.waveHeightFt,
        periodS:      prior.periodS,
        directionDeg: prior.directionDeg,
        windKts:      prior.windKts,
        windDir:      prior.windDir,
      },
      source:    'open-meteo-marine',
      stale:     true,
      fetchedAt,
    };
  }

  return {
    data:      { waveHeightFt: null, periodS: null, directionDeg: null, windKts: null, windDir: null },
    source:    'open-meteo-marine',
    stale:     true,
    fetchedAt,
  };
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchAllConditions(lat: number, lon: number): Promise<SwellReading> {
  const [marine, weather] = await Promise.all([
    fetchMarine(lat, lon),
    fetchWindFromForecast(lat, lon),
  ]);

  return {
    waveHeightFt: marine.waveHeightFt,
    periodS:      marine.periodS,
    directionDeg: marine.directionDeg,
    windKts:      weather.windKts,
    windDir:      weather.windDir,
  };
}

async function fetchMarine(lat: number, lon: number): Promise<Pick<SwellReading, 'waveHeightFt' | 'periodS' | 'directionDeg'>> {
  const url = `${MARINE_BASE}?latitude=${lat}&longitude=${lon}` +
              `&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction` +
              `&length_unit=imperial&timezone=America%2FLos_Angeles`;

  const res = await axios.get<OpenMeteoMarineResponse>(url, { timeout: 15_000 });
  const c   = res.data?.current;
  if (!c) return { waveHeightFt: null, periodS: null, directionDeg: null };

  // Prefer swell values over combined wave when available
  const ht  = c.swell_wave_height    ?? c.wave_height    ?? null;
  const per = c.swell_wave_period    ?? c.wave_period     ?? null;
  const dir = c.swell_wave_direction ?? c.wave_direction  ?? null;

  return {
    waveHeightFt: ht  != null ? Math.round(ht  * 10) / 10 : null,
    periodS:      per != null ? Math.round(per)            : null,
    directionDeg: dir != null ? Math.round(dir * 10) / 10 : null,
  };
}

async function fetchWindFromForecast(lat: number, lon: number): Promise<Pick<SwellReading, 'windKts' | 'windDir'>> {
  const url = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}` +
              `&current=wind_speed_10m,wind_direction_10m` +
              `&wind_speed_unit=kn&timezone=America%2FLos_Angeles`;

  const res = await axios.get<OpenMeteoForecastResponse>(url, { timeout: 15_000 });
  const c   = res.data?.current;
  if (!c) return { windKts: null, windDir: null };

  return {
    windKts: c.wind_speed_10m      != null ? Math.round(c.wind_speed_10m)      : null,
    windDir: c.wind_direction_10m  != null ? degToCompass(c.wind_direction_10m) : null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function degToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('[surf] Fatal:', err);
  process.exit(1);
});
