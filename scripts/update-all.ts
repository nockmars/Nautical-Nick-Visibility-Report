/**
 * scripts/update-all.ts
 *
 * Master orchestrator — runs the daily data pipeline in order:
 *   1. fetch-satellite  (chlorophyll_data)      — CRITICAL
 *   2. fetch-surf       (swell_data)             — CRITICAL
 *   3. fetch-weather    (weather_data + conditions) — CRITICAL
 *   4. scrape-justgetwet (conditions.sourceJson) — non-critical
 *
 * The pier-cam captures run on their own cron schedules (see GitHub Actions).
 * compute-visibility, generate-summary, and send-alerts are Phase 3 (Visibility Reporter).
 *
 * Exit behavior:
 *   - If any CRITICAL fetcher fails, exits non-zero after completing the rest.
 *   - JustGetWet failure is swallowed (it manages its own graceful exit).
 *
 * Usage: tsx scripts/update-all.ts
 * Env:   DATABASE_URL (+ optionally NASA_EARTHDATA_USER/PASS)
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import * as path from 'path';

if (!process.env.DATABASE_URL) {
  console.error('[update-all] Fatal: DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

interface ScriptDef {
  name: string;
  file: string;
  critical: boolean;
}

const SCRIPTS: ScriptDef[] = [
  { name: 'satellite',  file: 'fetchers/fetch-satellite.ts',  critical: true  },
  { name: 'surf',       file: 'fetchers/fetch-surf.ts',       critical: true  },
  { name: 'weather',    file: 'fetchers/fetch-weather.ts',    critical: true  },
  { name: 'justgetwet', file: 'scrapers/scrape-justgetwet.ts', critical: false },
];

async function main(): Promise<void> {
  const start = Date.now();
  console.log('\n===================================================');
  console.log('  Nautical Nick -- Daily Data Update (Phase 2 TS)');
  console.log(`  ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`);
  console.log('===================================================\n');

  let criticalFailure = false;

  for (const script of SCRIPTS) {
    const scriptPath = path.join(__dirname, script.file);
    console.log(`\n-- Running: ${script.name} --`);
    try {
      execSync(`npx tsx "${scriptPath}"`, {
        stdio:   'inherit',
        timeout: 180_000,
        env: {
          ...process.env,
          // Ensure DATABASE_URL propagates to child processes
          DATABASE_URL: process.env.DATABASE_URL,
        },
      });
      console.log(`[ok] ${script.name} complete`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (script.critical) {
        console.error(`[FAIL] ${script.name} failed (critical):`, msg);
        criticalFailure = true;
      } else {
        console.warn(`[warn] ${script.name} failed (non-critical):`, msg);
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n===================================================');
  console.log(`  Update complete in ${elapsed}s`);
  if (criticalFailure) {
    console.error('  One or more critical fetchers failed. Check logs above.');
  }
  console.log('===================================================\n');

  if (criticalFailure) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[update-all] Fatal:', err);
  process.exit(1);
});
