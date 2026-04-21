/**
 * update-all.js
 *
 * Master orchestrator — runs the full data pipeline in order:
 *   1. Fetch satellite chlorophyll (w/ yesterday-fallback)
 *   2. Fetch surf (swell + wind)
 *   3. Fetch weather (current + 5-day rain history)
 *   4. Scrape JustGetWet (San Diego ground truth)
 *   5. Compute reconciled visibility + range + confidence per spot
 *   6. Generate AI summary
 *   7. Send email alerts
 *
 * The pier cam captures run on their own separate schedules (see GitHub Actions).
 *
 * Usage: node scripts/update-all.js
 */

require('dotenv').config();

const { execSync } = require('child_process');
const path = require('path');

const SCRIPTS = [
  { name: 'satellite',  file: 'fetch-satellite.js' },
  { name: 'surf',       file: 'fetch-surf.js' },
  { name: 'weather',    file: 'fetch-weather.js' },
  { name: 'justgetwet', file: 'scrape-justgetwet.js' },
  { name: 'compute',    file: 'compute-visibility.js' },
  { name: 'summary',    file: 'generate-summary.js' },
  { name: 'alerts',     file: 'send-alerts.js' },
];

async function main() {
  const start = Date.now();
  console.log('\n═══════════════════════════════════════════');
  console.log('  Nautical Nick — Daily Data Update');
  console.log(`  ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`);
  console.log('═══════════════════════════════════════════\n');

  for (const script of SCRIPTS) {
    const scriptPath = path.join(__dirname, script.file);
    console.log(`\n── Running: ${script.name} ──`);
    try {
      execSync(`node "${scriptPath}"`, {
        stdio: 'inherit',
        timeout: 120_000,
      });
      console.log(`✓ ${script.name} complete`);
    } catch (err) {
      console.error(`✗ ${script.name} failed:`, err.message);
      // Continue — partial data is better than no update
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Update complete in ${elapsed}s`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(err => { console.error('update-all fatal:', err); process.exit(1); });
