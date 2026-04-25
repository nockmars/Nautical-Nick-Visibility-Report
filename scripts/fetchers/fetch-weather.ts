/**
 * scripts/fetchers/fetch-weather.ts
 *
 * Fetches current weather + 5-day precipitation history per location via
 * Open-Meteo (free, no API key). Writes one row to `weather_data` per
 * location per run, then upserts a `conditions` row with rain5dIn.
 *
 * On failure, falls back to the most recent prior weather_data row with
 * stale: true. A null row (stale: true) is written if no prior row exists.
 *
 * Usage: tsx scripts/fetchers/fetch-weather.ts
 * Env:   DATABASE_URL
 */

import 'dotenv/config';
import axios from 'axios';
import { prisma } from '../../lib/db/client';
import type {
  WeatherReading,
  FetcherResult,
  RainHistoryEntry,
  OpenMeteoForecastResponse,
} from '../../lib/data/types';

const WEATHER_BASE     = 'https://api.open-meteo.com/v1/forecast';
const PAST_DAYS        = 5;
const REQUEST_DELAY_MS = 200;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('[weather] Fatal: DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const locations = await prisma.location.findMany({
    orderBy: [{ regionId: 'asc' }, { slug: 'asc' }],
  });

  console.log(`[weather] Fetching weather + ${PAST_DAYS}-day rain for ${locations.length} locations...`);

  const now    = new Date();
  let success  = 0;
  let failed   = 0;

  for (const location of locations) {
    await sleep(REQUEST_DELAY_MS);

    const result = await fetchWeatherWithFallback(location.latitude, location.longitude, location.id);

    await prisma.weatherData.create({
      data: {
        locationId:      location.id,
        fetchedAt:       now,
        windMph:         result.data?.windMph ?? null,
        windDir:         result.data?.windDir ?? null,
        tempF:           result.data?.tempF ?? null,
        cloudPct:        result.data?.cloudPct ?? null,
        condition:       result.data?.condition ?? null,
        rain5dIn:        result.data?.rain5dIn ?? null,
        rainHistoryJson: (result.data?.rainHistoryJson ?? undefined) as object | undefined,
        source:          result.source,
        stale:           result.stale,
      },
    });

    // Write Condition row with rain signal + weather snapshot
    await prisma.condition.create({
      data: {
        locationId: location.id,
        computedAt: now,
        rain5dIn:   result.data?.rain5dIn ?? null,
        sourceJson: {
          weather: {
            tempF:     result.data?.tempF,
            cloudPct:  result.data?.cloudPct,
            condition: result.data?.condition,
            rain5dIn:  result.data?.rain5dIn,
            stale:     result.stale,
            source:    result.source,
            fetchedAt: now.toISOString(),
          },
        },
      },
    });

    if (result.stale) failed++;
    else success++;

    const tempStr = result.data?.tempF != null ? `${result.data.tempF}F` : '--F';
    const rainStr = result.data?.rain5dIn != null ? `${result.data.rain5dIn.toFixed(2)}"` : '--"';
    console.log(`  [${location.slug}] ${tempStr} ${result.data?.condition ?? '--'}, 5d rain ${rainStr}${result.stale ? ' (STALE)' : ''}`);
  }

  console.log(`\n[weather] Done: ${success} fresh, ${failed} stale.`);
  await prisma.$disconnect();
}

// ── Fetch with fallback ───────────────────────────────────────────────────────

async function fetchWeatherWithFallback(
  lat: number,
  lon: number,
  locationId: string,
): Promise<FetcherResult<WeatherReading>> {
  const fetchedAt = new Date();

  try {
    const reading = await fetchWeather(lat, lon);
    return {
      data:      reading,
      source:    'open-meteo',
      stale:     false,
      fetchedAt,
    };
  } catch (err) {
    console.warn(`  [weather] live fetch failed for ${lat},${lon}:`, (err as Error).message);
  }

  // Fallback to most recent prior row
  const prior = await prisma.weatherData.findFirst({
    where:   { locationId },
    orderBy: { fetchedAt: 'desc' },
  });

  if (prior) {
    const rainHistory = Array.isArray(prior.rainHistoryJson)
      ? (prior.rainHistoryJson as unknown as RainHistoryEntry[])
      : [];
    return {
      data: {
        windMph:         prior.windMph,
        windDir:         prior.windDir,
        tempF:           prior.tempF,
        cloudPct:        prior.cloudPct,
        condition:       prior.condition,
        rain5dIn:        prior.rain5dIn ?? 0,
        rainHistoryJson: rainHistory,
      },
      source:    'open-meteo',
      stale:     true,
      fetchedAt,
    };
  }

  return {
    data: {
      windMph: null, windDir: null, tempF: null, cloudPct: null,
      condition: null, rain5dIn: 0, rainHistoryJson: [],
    },
    source:    'open-meteo',
    stale:     true,
    fetchedAt,
  };
}

// ── Open-Meteo fetch ──────────────────────────────────────────────────────────

async function fetchWeather(lat: number, lon: number): Promise<WeatherReading> {
  const url = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}` +
              `&current=temperature_2m,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m` +
              `&daily=precipitation_sum` +
              `&past_days=${PAST_DAYS}&forecast_days=1` +
              `&temperature_unit=fahrenheit&precipitation_unit=inch` +
              `&wind_speed_unit=mph` +
              `&timezone=America%2FLos_Angeles`;

  const res = await axios.get<OpenMeteoForecastResponse>(url, { timeout: 15_000 });
  const d   = res.data;

  const tempF    = d.current?.temperature_2m != null ? Math.round(d.current.temperature_2m) : null;
  const cloudPct = d.current?.cloud_cover    != null ? Math.round(d.current.cloud_cover)    : null;
  const windMph  = d.current?.wind_speed_10m != null ? Math.round(d.current.wind_speed_10m) : null;
  const windDir  = d.current?.wind_direction_10m != null
    ? degToCompass(d.current.wind_direction_10m)
    : null;
  const code = d.current?.weather_code ?? null;

  const dailyTimes  = d.daily?.time               ?? [];
  const dailyPrecip = d.daily?.precipitation_sum  ?? [];

  // Drop today (index PAST_DAYS) so we have only past rain
  const rainHistoryJson: RainHistoryEntry[] = dailyTimes
    .slice(0, PAST_DAYS)
    .map((date, i) => ({
      date,
      inches: Math.round((dailyPrecip[i] ?? 0) * 100) / 100,
    }));

  const rain5dIn = rainHistoryJson.reduce((sum, r) => sum + r.inches, 0);

  return {
    tempF,
    cloudPct,
    windMph,
    windDir,
    condition:      wmoCodeToCondition(code),
    rain5dIn:       Math.round(rain5dIn * 100) / 100,
    rainHistoryJson,
  };
}

// ── WMO code → condition string ───────────────────────────────────────────────

/**
 * Converts an Open-Meteo WMO weather code to a human-readable condition string.
 * Reference: https://open-meteo.com/en/docs
 */
export function wmoCodeToCondition(code: number | null | undefined): string | null {
  if (code == null) return null;
  if (code === 0)                       return 'clear';
  if (code >= 1  && code <= 3)          return 'partly-cloudy';
  if (code === 45 || code === 48)       return 'fog';
  if (code >= 51  && code <= 57)        return 'drizzle';
  if (code >= 61  && code <= 65)        return 'rain';
  if (code >= 66  && code <= 67)        return 'freezing-rain';
  if (code >= 71  && code <= 77)        return 'snow';
  if (code >= 80  && code <= 82)        return 'rain-showers';
  if (code >= 85  && code <= 86)        return 'snow-showers';
  if (code >= 95)                       return 'thunderstorm';
  return 'cloudy';
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
  console.error('[weather] Fatal:', err);
  process.exit(1);
});
