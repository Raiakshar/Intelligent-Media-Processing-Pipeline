import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { detectBlur } from '../src/analysis/blur';
import { analyzeBrightness } from '../src/analysis/brightness';
import { validateDimensions } from '../src/analysis/dimensions';
import { hammingDistance, perceptualHash, sha256File } from '../src/utils/hash';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-pipeline-test-'));

async function makeSolidImage(name: string, opts: { width: number; height: number; color: string }) {
  const filePath = path.join(tmpDir, name);
  await sharp({
    create: { width: opts.width, height: opts.height, channels: 3, background: opts.color },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
  return filePath;
}

async function makeNoisyImage(name: string, opts: { width: number; height: number }) {
  // Random noise buffer -> lots of high-frequency detail -> should NOT
  // be flagged as blurry (high Laplacian variance), unlike a flat color.
  const filePath = path.join(tmpDir, name);
  const size = opts.width * opts.height * 3;
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buffer[i] = Math.floor(Math.random() * 256);

  await sharp(buffer, { raw: { width: opts.width, height: opts.height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(filePath);
  return filePath;
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('blur detection', () => {
  it('flags a flat solid-color image as blurry (no edges)', async () => {
    const file = await makeSolidImage('flat.jpg', { width: 600, height: 400, color: '#808080' });
    const result = await detectBlur(file);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('high');
  });

  it('does not flag a high-frequency noisy image as blurry', async () => {
    const file = await makeNoisyImage('noisy.jpg', { width: 600, height: 400 });
    const result = await detectBlur(file);
    expect(result.passed).toBe(true);
  });
});

describe('brightness analysis', () => {
  it('flags a near-black image as low light', async () => {
    const file = await makeSolidImage('dark.jpg', { width: 400, height: 300, color: '#050505' });
    const result = await analyzeBrightness(file);
    expect(result.passed).toBe(false);
    expect(result.details.meanBrightness).toBeLessThan(60);
  });

  it('flags a near-white image as overexposed', async () => {
    const file = await makeSolidImage('bright.jpg', { width: 400, height: 300, color: '#fafafa' });
    const result = await analyzeBrightness(file);
    expect(result.passed).toBe(false);
  });

  it('passes a mid-gray image', async () => {
    const file = await makeSolidImage('midgray.jpg', { width: 400, height: 300, color: '#969696' });
    const result = await analyzeBrightness(file);
    expect(result.passed).toBe(true);
  });
});

describe('dimension validation', () => {
  it('fails an image below the minimum resolution', async () => {
    const file = await makeSolidImage('tiny.jpg', { width: 100, height: 80, color: '#333333' });
    const result = await validateDimensions(file);
    expect(result.passed).toBe(false);
  });

  it('passes an image at/above the minimum resolution', async () => {
    const file = await makeSolidImage('normal.jpg', { width: 1200, height: 900, color: '#333333' });
    const result = await validateDimensions(file);
    expect(result.passed).toBe(true);
  });
});

describe('hashing utilities', () => {
  it('sha256File produces identical hashes for identical files', async () => {
    const fileA = await makeSolidImage('dupA.jpg', { width: 300, height: 300, color: '#123456' });
    const fileB = path.join(tmpDir, 'dupB.jpg');
    fs.copyFileSync(fileA, fileB);
    expect(sha256File(fileA)).toEqual(sha256File(fileB));
  });

  it('perceptualHash gives 0 hamming distance for identical images', async () => {
    const file = await makeSolidImage('phashA.jpg', { width: 500, height: 400, color: '#654321' });
    const hashA = await perceptualHash(file);
    const hashB = await perceptualHash(file);
    expect(hammingDistance(hashA, hashB)).toBe(0);
  });

  it('perceptualHash gives large hamming distance for very different images', async () => {
    const fileA = await makeSolidImage('phashBlack.jpg', { width: 400, height: 300, color: '#000000' });
    const fileB = await makeSolidImage('phashWhite.jpg', { width: 400, height: 300, color: '#ffffff' });
    const hashA = await perceptualHash(fileA);
    const hashB = await perceptualHash(fileB);
    expect(hammingDistance(hashA, hashB)).toBeGreaterThan(30);
  });
});
