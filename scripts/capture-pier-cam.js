/**
 * capture-pier-cam.js
 *
 * Takes a screenshot of the Scripps Pier underwater webcam, sends it to
 * Claude Vision to identify which pilings are visible and estimate
 * visibility, then writes the result into data/snapshots.json.
 *
 * Usage:
 *   CAPTURE_TIME=07:00 node scripts/capture-pier-cam.js
 *   CAPTURE_TIME=09:00 node scripts/capture-pier-cam.js
 *   CAPTURE_TIME=12:00 node scripts/capture-pier-cam.js
 *
 * Environment variables required:
 *   ANTHROPIC_API_KEY
 */

require('dotenv').config();

const puppeteer = require('puppeteer');
const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');
const fs        = require('fs');

const PIER_CAM_URL   = 'https://coollab.ucsd.edu/pierviz/';
const SNAPSHOTS_DIR  = path.join(__dirname, '..', 'data', 'snapshots');
const SNAPSHOTS_JSON = path.join(__dirname, '..', 'data', 'snapshots.json');

const CAPTURE_TIME = process.env.CAPTURE_TIME || '09:00'; // e.g. "07:00"

// Piling distances for Claude prompt
const PILING_INFO = `
The Scripps Pier underwater camera shows concrete pier pilings at known distances:
- "right-front-4ft":  the front-right piling is approximately 4 feet from the camera
- "right-back-11ft":  the back-right piling is approximately 11 feet from the camera
- "back-left-14ft":   the back-left piling is approximately 14 feet from the camera
- "far-left-30ft":    the far-left piling is approximately 30 feet from the camera
`.trim();

async function main() {
  ensureDir(SNAPSHOTS_DIR);

  const today    = todayPacific();
  const filename = `${today}-${CAPTURE_TIME.replace(':', '')}.jpg`;
  const imgPath  = path.join(SNAPSHOTS_DIR, filename);
  const relPath  = `data/snapshots/${filename}`;

  console.log(`[pier-cam] Capturing ${CAPTURE_TIME} snapshot for ${today}…`);

  // 1. Take screenshot with Puppeteer
  const screenshot = await captureScreenshot(imgPath);
  console.log(`[pier-cam] Screenshot saved: ${imgPath}`);

  // 2. Analyze with Claude Vision
  const analysis = await analyzeWithClaude(screenshot);
  console.log(`[pier-cam] Analysis: visibility=${analysis.estimatedVisibility}ft, rating=${analysis.rating}`);

  // 3. Update snapshots.json
  updateSnapshotsJson(today, CAPTURE_TIME, relPath, analysis);
  console.log(`[pier-cam] snapshots.json updated.`);
}

// ── Puppeteer screenshot ───────────────────────────────────────────────────
async function captureScreenshot(savePath) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(PIER_CAM_URL, {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    });

    // Wait for the camera image/canvas to appear
    await page.waitForSelector('img, canvas', { timeout: 20_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000)); // let stream settle

    // Try to find and screenshot just the video/image element
    const camSelector = 'canvas, video, img[src*="cam"], img[src*="snap"]';
    const camEl = await page.$(camSelector);

    let screenshotBuffer;
    if (camEl) {
      screenshotBuffer = await camEl.screenshot({ type: 'jpeg', quality: 90 });
    } else {
      // Fall back to full page screenshot
      screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 85 });
    }

    fs.writeFileSync(savePath, screenshotBuffer);
    return screenshotBuffer;
  } finally {
    await browser.close();
  }
}

// ── Claude Vision analysis ────────────────────────────────────────────────
async function analyzeWithClaude(imageBuffer) {
  const client = new Anthropic();
  const base64 = imageBuffer.toString('base64');

  const prompt = `${PILING_INFO}

You are analyzing an underwater webcam photo taken from beneath Scripps Pier in La Jolla, San Diego.

Carefully examine the image and determine which of the four pier pilings are visible:
1. right-front-4ft (closest, should almost always be visible)
2. right-back-11ft
3. back-left-14ft
4. far-left-30ft (farthest — only visible on high-clarity days)

Based on the farthest visible piling, estimate the horizontal underwater visibility.
Also assess overall water clarity (EXCELLENT / GOOD / FAIR / POOR) and describe what you see.

Respond ONLY with valid JSON in exactly this format:
{
  "pillingsVisible": ["right-front-4ft", "right-back-11ft"],
  "estimatedVisibility": 11,
  "rating": "GOOD",
  "description": "Two pilings visible through blue-green water. Moderate particulate. Surge minimal."
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content[0].text.trim();

  // Strip markdown code fences if present
  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.warn('[pier-cam] Could not parse Claude response, using fallback');
    return {
      pillingsVisible: [],
      estimatedVisibility: null,
      rating: 'FAIR',
      description: 'Analysis unavailable — image may be too dark or camera offline.',
    };
  }
}

// ── Update snapshots.json ─────────────────────────────────────────────────
function updateSnapshotsJson(date, time, imagePath, analysis) {
  let data = { date, snapshots: [] };

  if (fs.existsSync(SNAPSHOTS_JSON)) {
    try {
      data = JSON.parse(fs.readFileSync(SNAPSHOTS_JSON, 'utf8'));
    } catch {}
  }

  // Reset if this is a new day
  if (data.date !== date) {
    data = { date, snapshots: [] };
  }

  // Remove existing entry for this time slot
  data.snapshots = data.snapshots.filter(s => s.time !== time);

  const labelMap = { '07:00': '7:00 AM', '09:00': '9:00 AM', '12:00': '12:00 PM' };

  data.snapshots.push({
    time,
    label: labelMap[time] || time,
    imagePath,
    rating:      analysis.rating,
    visibility:  analysis.estimatedVisibility,
    description: analysis.description,
    pillingsVisible: analysis.pillingsVisible || [],
    captured: true,
    isLatest: false,
  });

  // Sort by time and mark latest captured
  const order = ['07:00', '09:00', '12:00'];
  data.snapshots.sort((a, b) => order.indexOf(a.time) - order.indexOf(b.time));

  const captured = data.snapshots.filter(s => s.captured);
  data.snapshots.forEach(s => { s.isLatest = false; });
  if (captured.length > 0) captured[captured.length - 1].isLatest = true;

  fs.writeFileSync(SNAPSHOTS_JSON, JSON.stringify(data, null, 2));
}

// ── Utils ─────────────────────────────────────────────────────────────────
function todayPacific() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

main().catch(err => { console.error('[pier-cam] Fatal:', err); process.exit(1); });
