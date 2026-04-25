/**
 * scripts/captures/capture-pier-cam.ts
 *
 * Takes a screenshot of the Scripps Pier underwater webcam using Puppeteer,
 * sends it to Claude Vision to identify visible pilings and estimate visibility,
 * then writes the result to the `satellite_data` table.
 *
 * JPGs are also saved to data/snapshots/ (same path as the vanilla script).
 *
 * Usage:
 *   CAPTURE_TIME=07:00 tsx scripts/captures/capture-pier-cam.ts
 *   CAPTURE_TIME=09:00 tsx scripts/captures/capture-pier-cam.ts
 *   CAPTURE_TIME=12:00 tsx scripts/captures/capture-pier-cam.ts
 *
 * Env: ANTHROPIC_API_KEY, DATABASE_URL
 */

import 'dotenv/config';
import puppeteer from 'puppeteer';
import Anthropic from '@anthropic-ai/sdk';
import * as path from 'path';
import * as fs from 'fs';
import { prisma } from '../../lib/db/client';
import type { PierCamAnalysis } from '../../lib/data/types';

// ── Env validation ────────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error('[pier-cam] Fatal: DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[pier-cam] Fatal: ANTHROPIC_API_KEY is not set. Aborting.');
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

const PIER_CAM_URL  = 'https://coollab.ucsd.edu/pierviz/';
const SNAPSHOTS_DIR = path.join(__dirname, '..', '..', 'data', 'snapshots');
const CAPTURE_TIME  = process.env.CAPTURE_TIME ?? '09:00';

const PILING_INFO = `
The Scripps Pier underwater camera shows concrete pier pilings at known distances:
- "right-front-4ft":  the front-right piling is approximately 4 feet from the camera
- "right-back-11ft":  the back-right piling is approximately 11 feet from the camera
- "back-left-14ft":   the back-left piling is approximately 14 feet from the camera
- "far-left-30ft":    the far-left piling is approximately 30 feet from the camera
`.trim();

// Scripps Pier location slug in the DB — this is the SD location nearest the pier
const PIER_LOCATION_SLUG = 'underwater-park';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDir(SNAPSHOTS_DIR);

  const today    = todayPacific();
  const filename = `${today}-${CAPTURE_TIME.replace(':', '')}.jpg`;
  const imgPath  = path.join(SNAPSHOTS_DIR, filename);
  const relPath  = `data/snapshots/${filename}`;

  console.log(`[pier-cam] Capturing ${CAPTURE_TIME} snapshot for ${today}...`);

  // 1. Find the location row (Scripps Pier sits at La Jolla Underwater Park)
  const location = await prisma.location.findUnique({
    where: { slug: PIER_LOCATION_SLUG },
  });

  if (!location) {
    console.error(`[pier-cam] Fatal: location slug '${PIER_LOCATION_SLUG}' not found in DB.`);
    console.error('[pier-cam] Ensure the locations table is seeded before running this script.');
    process.exit(1);
  }

  // 2. Take screenshot with Puppeteer
  const screenshot = await captureScreenshot(imgPath);
  console.log(`[pier-cam] Screenshot saved: ${imgPath}`);

  // 3. Analyze with Claude Vision
  const analysis = await analyzeWithClaude(screenshot);
  console.log(`[pier-cam] Analysis: visibility=${analysis.estimatedVisibility ?? '--'}ft, rating=${analysis.rating}`);

  // 4. Write to satellite_data
  await prisma.satelliteData.create({
    data: {
      locationId:  location.id,
      fetchedAt:   new Date(),
      imageUrl:    relPath,
      captureTime: CAPTURE_TIME,
      metadata:    analysis as unknown as object,
      source:      'scripps-pier-cam',
      stale:       false,
    },
  });

  console.log('[pier-cam] satellite_data row written.');
  await prisma.$disconnect();
}

// ── Puppeteer screenshot ──────────────────────────────────────────────────────

async function captureScreenshot(savePath: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
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

    // Wait for image or canvas to appear
    await page.waitForSelector('img, canvas', { timeout: 20_000 }).catch(() => {});
    await new Promise<void>(r => setTimeout(r, 3000)); // let stream settle

    const camSelector = 'canvas, video, img[src*="cam"], img[src*="snap"]';
    const camEl = await page.$(camSelector);

    let screenshotBuffer: Buffer;
    if (camEl) {
      screenshotBuffer = Buffer.from(await camEl.screenshot({ type: 'jpeg', quality: 90 }));
    } else {
      screenshotBuffer = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 85 }));
    }

    fs.writeFileSync(savePath, screenshotBuffer);
    return screenshotBuffer;
  } finally {
    await browser.close();
  }
}

// ── Claude Vision analysis ────────────────────────────────────────────────────

async function analyzeWithClaude(imageBuffer: Buffer): Promise<PierCamAnalysis> {
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
    model:      'claude-opus-4-7',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text  = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    return JSON.parse(clean) as PierCamAnalysis;
  } catch {
    console.warn('[pier-cam] Could not parse Claude response, using fallback');
    return {
      pillingsVisible:     [],
      estimatedVisibility: null,
      rating:              'FAIR',
      description:         'Analysis unavailable — image may be too dark or camera offline.',
    };
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function todayPacific(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

main().catch(err => {
  console.error('[pier-cam] Fatal:', err);
  process.exit(1);
});
