/**
 * lib/data/types.ts
 *
 * Shared types for the Phase 2 ocean-data pipeline.
 * These types describe raw fetcher inputs/outputs and are consumed by
 * the individual fetcher scripts under scripts/fetchers/, scripts/scrapers/,
 * and scripts/captures/.
 */

// ── Source attribution strings ────────────────────────────────────────────────

export type OceanSource =
  | 'noaa-coastwatch'
  | 'noaa-westcoast'
  | 'nasa-oceancolor'
  | 'cached'
  | 'unavailable'
  | 'open-meteo-marine'
  | 'open-meteo'
  | 'justgetwet'
  | 'scripps-pier-cam';

// ── Location row (read from DB via prisma.location.findMany) ──────────────────

export interface LocationRow {
  id: string;
  slug: string;
  regionId: string;
  name: string;
  type: string;
  maxDepth: number;
  latitude: number;
  longitude: number;
  imageUrl: string | null;
}

// ── Generic fetcher result envelope ──────────────────────────────────────────

export interface FetcherResult<T> {
  /** The data payload; null if the fetch failed completely. */
  data: T | null;
  /** The source that produced this result. */
  source: OceanSource;
  /** True when no live data was available and we fell back to a prior row. */
  stale: boolean;
  /** UTC timestamp of when the fetch was attempted. */
  fetchedAt: Date;
  /** Raw response payload from the source, for audit purposes. */
  raw?: unknown;
}

// ── Chlorophyll ───────────────────────────────────────────────────────────────

export interface ChlorophyllReading {
  valueMgM3: number | null;
  /** ISO timestamp reported by the source dataset (may differ from fetchedAt). */
  dataTimestamp: string | null;
}

// ── Swell / surf ─────────────────────────────────────────────────────────────

export interface SwellReading {
  waveHeightFt: number | null;
  periodS: number | null;
  directionDeg: number | null;
  windKts: number | null;
  windDir: string | null;
}

// ── Weather ───────────────────────────────────────────────────────────────────

export interface RainHistoryEntry {
  date: string;   // YYYY-MM-DD
  inches: number;
}

export interface WeatherReading {
  windMph: number | null;
  windDir: string | null;
  tempF: number | null;
  cloudPct: number | null;
  condition: string | null;
  rain5dIn: number;
  rainHistoryJson: RainHistoryEntry[];
}

// ── JustGetWet scrape ─────────────────────────────────────────────────────────

export interface JustGetWetResult {
  estimatedVisibility: number | null;
  report: string;
  sourceUrl: string;
}

// ── Pier cam vision analysis ──────────────────────────────────────────────────

export interface PierCamAnalysis {
  pillingsVisible: string[];
  estimatedVisibility: number | null;
  rating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  description: string;
}

// ── Open-Meteo marine API response (subset we use) ───────────────────────────

export interface OpenMeteoMarineCurrent {
  wave_height?: number | null;
  wave_period?: number | null;
  wave_direction?: number | null;
  swell_wave_height?: number | null;
  swell_wave_period?: number | null;
  swell_wave_direction?: number | null;
  wind_speed_10m?: number | null;
  wind_direction_10m?: number | null;
}

export interface OpenMeteoMarineResponse {
  current?: OpenMeteoMarineCurrent;
}

// ── Open-Meteo forecast API response (subset we use) ─────────────────────────

export interface OpenMeteoForecastCurrent {
  temperature_2m?: number | null;
  cloud_cover?: number | null;
  weather_code?: number | null;
  wind_speed_10m?: number | null;
  wind_direction_10m?: number | null;
}

export interface OpenMeteoForecastResponse {
  current?: OpenMeteoForecastCurrent;
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
  };
}

// ── ERDDAP table response ─────────────────────────────────────────────────────

export interface ErddapTableResponse {
  table?: {
    columnNames: string[];
    rows: (string | number | null)[][];
  };
}
