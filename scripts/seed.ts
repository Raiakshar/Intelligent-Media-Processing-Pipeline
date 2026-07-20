/**
 * Seed script: generates a couple of synthetic test images (so the repo
 * doesn't need to ship real vehicle photos) and uploads them through the
 * real service layer, so you get a couple of processed rows to poke at
 * immediately via the Results API after running `npm run seed`.
 *
 * Requires the worker to be running separately to actually process them
 * (this script only enqueues, consistent with the real API flow).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createImageRecord } from '../src/services/imageService';
import { prisma } from '../src/db';
import { config } from '../src/config';

async function makeSyntheticImage(filePath: string, opts: { color: string; width: number; height: number }) {
  await sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: 3,
      background: opts.color,
    },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
}

async function main() {
  if (!fs.existsSync(config.uploadDir)) fs.mkdirSync(config.uploadDir, { recursive: true });

  const seedDir = path.join(config.uploadDir, '_seed_tmp');
  if (!fs.existsSync(seedDir)) fs.mkdirSync(seedDir, { recursive: true });

  // A normal-ish sized synthetic image (will fail OCR/plate check since
  // it has no real plate text -- that's expected and fine for a seed demo).
  const sample1 = path.join(seedDir, 'sample-normal.jpg');
  await makeSyntheticImage(sample1, { color: '#888888', width: 1200, height: 900 });

  // A tiny image, deliberately below the dimension threshold.
  const sample2 = path.join(seedDir, 'sample-small.jpg');
  await makeSyntheticImage(sample2, { color: '#222222', width: 100, height: 80 });

  for (const file of [sample1, sample2]) {
    const stat = fs.statSync(file);
    const destFilename = `${Date.now()}-${path.basename(file)}`;
    const destPath = path.join(config.uploadDir, destFilename);
    fs.copyFileSync(file, destPath);

    const image = await createImageRecord({
      originalName: path.basename(file),
      storedFilename: destFilename,
      storagePath: destPath,
      mimeType: 'image/jpeg',
      sizeBytes: stat.size,
    });

    console.log(`Seeded image ${image.id} (${path.basename(file)}) -- queued for processing.`);
    console.log(`  Check status:  GET /images/${image.id}/status`);
    console.log(`  Check results: GET /images/${image.id}/results`);
  }

  fs.rmSync(seedDir, { recursive: true, force: true });
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
