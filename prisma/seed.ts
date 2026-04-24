/**
 * prisma/seed.ts
 *
 * Seeds the `locations` table from data/regions.json and data/spot-details.json.
 * Run via: npx prisma db seed
 *
 * The slug format used in regions.json is the bare spot slug (e.g. "la-jolla-cove").
 * We store it as-is in location.slug so URLs stay simple.
 * regionId is the region slug (e.g. "san-diego").
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SpotEntry {
  slug: string;
  name: string;
  coords: { lat: number; lon: number };
  maxDepth: number;
  type: string;
}

interface RegionEntry {
  slug: string;
  name: string;
  displayName: string;
  centerCoords: { lat: number; lon: number };
  spots: SpotEntry[];
}

interface RegionsFile {
  regions: RegionEntry[];
}

interface SpotDetail {
  spearingRating?: number;
  summary?: string;
  season?: Record<string, string[]>;
  huntingTips?: string[];
  prediction14Day?: string;
}

interface SpotDetailsFile {
  spots: Record<string, SpotDetail>;
}

async function main() {
  const regionsPath = path.join(__dirname, '..', 'data', 'regions.json');
  const detailsPath = path.join(__dirname, '..', 'data', 'spot-details.json');

  const regionsFile: RegionsFile = JSON.parse(fs.readFileSync(regionsPath, 'utf8'));
  const detailsFile: SpotDetailsFile = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));

  console.log(`Seeding locations from ${regionsFile.regions.length} regions...`);

  let upserted = 0;

  for (const region of regionsFile.regions) {
    for (const spot of region.spots) {
      const detail = detailsFile.spots[spot.slug];

      await prisma.location.upsert({
        where: { slug: spot.slug },
        update: {
          regionId:  region.slug,
          name:      spot.name,
          type:      spot.type,
          maxDepth:  spot.maxDepth,
          latitude:  spot.coords.lat,
          longitude: spot.coords.lon,
          imageUrl:  null, // Phase 4: add imageUrl per spot
        },
        create: {
          slug:      spot.slug,
          regionId:  region.slug,
          name:      spot.name,
          type:      spot.type,
          maxDepth:  spot.maxDepth,
          latitude:  spot.coords.lat,
          longitude: spot.coords.lon,
          imageUrl:  null,
        },
      });

      upserted++;
    }
  }

  console.log(`Seeded ${upserted} locations.`);

  // Log detail coverage
  const detailKeys = Object.keys(detailsFile.spots);
  console.log(`spot-details.json has ${detailKeys.length} entries (used by Visibility Reporter in Phase 3).`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
