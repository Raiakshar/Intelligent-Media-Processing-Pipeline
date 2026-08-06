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

async function makeTwoToneImage(name: string, width: number, height: number, darkOnLeft: boolean) {
  // Left/right split: one side near-black, the other near-white. Inverting the
  // layout produces visually opposite images so aHash distances are meaningful.
  const filePath = path.join(tmpDir, name);
  const buffer = Buffer.alloc(width * height * 3);
  const dark = [10, 10, 10];
  const light = [245, 245, 245];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = x < width / 2;
      const useDark = darkOnLeft ? left : !left;
      const c = useDark ? dark : light;
      const i = (y * width + x) * 3;
      buffer[i] = c[0];
      buffer[i + 1] = c[1];
      buffer[i + 2] = c[2];
    }
  }
  await sharp(buffer, { raw: { width, height, channels: 3 } })
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
    // Solid-color fixtures would be degenerate: aHash of any uniform image is
    // all-ones (every pixel >= mean), so black vs white both hash to the same
    // value. Use genuinely different two-tone layouts instead.
    const halfLeft = await makeTwoToneImage('phashLeft.jpg', 400, 300, true);
    const halfRight = await makeTwoToneImage('phashRight.jpg', 400, 300, false);
    const hashA = await perceptualHash(halfLeft);
    const hashB = await perceptualHash(halfRight);
    expect(hammingDistance(hashA, hashB)).toBeGreaterThan(20);
  });
});
