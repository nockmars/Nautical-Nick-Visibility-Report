-- Phase 2: flesh out ocean-data tables
-- Tables are empty in preview Postgres (verified 2026-04-24), so renames are safe.

-- ── conditions ────────────────────────────────────────────────────────────────
-- Rename observed_at → computed_at
ALTER TABLE "conditions" RENAME COLUMN "observed_at" TO "computed_at";

-- Drop old index; recreate under new column name
DROP INDEX IF EXISTS "conditions_observed_at_idx";
CREATE INDEX "conditions_computed_at_idx" ON "conditions"("computed_at");

-- Add new columns
ALTER TABLE "conditions" ADD COLUMN "rain_5d_in" DOUBLE PRECISION;
ALTER TABLE "conditions" ADD COLUMN "source_json" JSONB;

-- ── satellite_data ────────────────────────────────────────────────────────────
-- Rename observed_at → fetched_at
ALTER TABLE "satellite_data" RENAME COLUMN "observed_at" TO "fetched_at";

DROP INDEX IF EXISTS "satellite_data_observed_at_idx";
CREATE INDEX "satellite_data_fetched_at_idx" ON "satellite_data"("fetched_at");

ALTER TABLE "satellite_data" ADD COLUMN "image_url" TEXT;
ALTER TABLE "satellite_data" ADD COLUMN "capture_time" TEXT;
ALTER TABLE "satellite_data" ADD COLUMN "metadata" JSONB;
ALTER TABLE "satellite_data" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'scripps-pier-cam';
ALTER TABLE "satellite_data" ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT false;

-- ── weather_data ──────────────────────────────────────────────────────────────
-- Rename observed_at → fetched_at
ALTER TABLE "weather_data" RENAME COLUMN "observed_at" TO "fetched_at";

DROP INDEX IF EXISTS "weather_data_observed_at_idx";
CREATE INDEX "weather_data_fetched_at_idx" ON "weather_data"("fetched_at");

ALTER TABLE "weather_data" ADD COLUMN "wind_mph" DOUBLE PRECISION;
ALTER TABLE "weather_data" ADD COLUMN "wind_dir" TEXT;
ALTER TABLE "weather_data" ADD COLUMN "temp_f" DOUBLE PRECISION;
ALTER TABLE "weather_data" ADD COLUMN "cloud_pct" INTEGER;
ALTER TABLE "weather_data" ADD COLUMN "condition" TEXT;
ALTER TABLE "weather_data" ADD COLUMN "rain_5d_in" DOUBLE PRECISION;
ALTER TABLE "weather_data" ADD COLUMN "rain_history_json" JSONB;
ALTER TABLE "weather_data" ADD COLUMN "source" TEXT NOT NULL DEFAULT '';
ALTER TABLE "weather_data" ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT false;

-- ── tide_data ─────────────────────────────────────────────────────────────────
-- Rename observed_at → fetched_at
ALTER TABLE "tide_data" RENAME COLUMN "observed_at" TO "fetched_at";

DROP INDEX IF EXISTS "tide_data_observed_at_idx";
CREATE INDEX "tide_data_fetched_at_idx" ON "tide_data"("fetched_at");

ALTER TABLE "tide_data" ADD COLUMN "tide_ft" DOUBLE PRECISION;
ALTER TABLE "tide_data" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'reserved';
ALTER TABLE "tide_data" ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT false;

-- ── swell_data ────────────────────────────────────────────────────────────────
-- Rename observed_at → fetched_at
ALTER TABLE "swell_data" RENAME COLUMN "observed_at" TO "fetched_at";

DROP INDEX IF EXISTS "swell_data_observed_at_idx";
CREATE INDEX "swell_data_fetched_at_idx" ON "swell_data"("fetched_at");

ALTER TABLE "swell_data" ADD COLUMN "wave_height_ft" DOUBLE PRECISION;
ALTER TABLE "swell_data" ADD COLUMN "period_s" INTEGER;
ALTER TABLE "swell_data" ADD COLUMN "direction_deg" DOUBLE PRECISION;
ALTER TABLE "swell_data" ADD COLUMN "wind_kts" DOUBLE PRECISION;
ALTER TABLE "swell_data" ADD COLUMN "wind_dir" TEXT;
ALTER TABLE "swell_data" ADD COLUMN "source" TEXT NOT NULL DEFAULT '';
ALTER TABLE "swell_data" ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT false;

-- ── chlorophyll_data ──────────────────────────────────────────────────────────
-- Rename observed_at → fetched_at
ALTER TABLE "chlorophyll_data" RENAME COLUMN "observed_at" TO "fetched_at";

DROP INDEX IF EXISTS "chlorophyll_data_observed_at_idx";
CREATE INDEX "chlorophyll_data_fetched_at_idx" ON "chlorophyll_data"("fetched_at");

ALTER TABLE "chlorophyll_data" ADD COLUMN "value_mg_m3" DOUBLE PRECISION;
ALTER TABLE "chlorophyll_data" ADD COLUMN "source" TEXT NOT NULL DEFAULT '';
ALTER TABLE "chlorophyll_data" ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chlorophyll_data" ADD COLUMN "raw" JSONB;
