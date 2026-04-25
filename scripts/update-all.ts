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
import { spawn } from 'child_process';
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
  { name: 'satellite',  file: 'fetchers/fetch-satellite.ts',   critical: true  },
  { name: 'surf',       file: 'fetchers/fetch-surf.ts',        critical: true  },
  { name: 'weather',    file: 'fetchers/fetch-weather.ts',     critical: true  },
  { name: 'justgetwet', file: 'scrapers/scrape-justgetwet.ts', critical: false },
];

// Per-script timeout. Satellite runs ~17 SD locations × (15s req + 350ms delay)
// ≈ ~260s worst-case with all sources failing; in practice 1 source succeeds
// quickly. 120s gives healthy headroom for the happy path.
const SCRIPT_TIMEOUT_MS = 120_000;

/**
 * Run a tsx script as a child process with a hard timeout.
 * Returns the exit code, or throws on timeout (child is SIGKILL'd).
 */
function runScript(scriptPath: string, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['tsx', scriptPath],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
        },
        // shell: false — we exec npx directly, no /bin/sh in the middle.
        // This means SIGKILL on timeout reaches the actual Node process.
        shell: false,
      },
    );

    const timer = setTimeout(() => {
      console.error(`[update-all] ${name} exceeded ${SCRIPT_TIMEOUT_MS / 1000}s — killing child.`);
      child.kill('SIGKILL');
      reject(new Error(`${name} timed out after ${SCRIPT_TIMEOUT_MS / 1000}s`));
    }, SCRIPT_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

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
      const code = await runScript(scriptPath, script.name);
      if (code !== 0) {
        throw new Error(`exited with code ${code}`);
      }
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
