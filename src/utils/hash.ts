import crypto from 'crypto';
import fs from 'fs';
import sharp from 'sharp';

/** Exact byte-for-byte hash. Cheap, catches identical re-uploads instantly. */
export function sha256File(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Perceptual hash (average hash / aHash).
 *
 * Why aHash and not pHash/dHash: aHash is the simplest to implement
 * correctly with just `sharp` (no DCT/FFT dependency), is fast, and is
 * good enough to catch near-duplicates (recompressed, slightly resized,
 * minor crop) which is the realistic "duplicate field photo" case here.
 * It is *not* robust to rotation or heavy cropping -- documented as a
 * known limitation in the README.
 *
 * Algorithm:
 *  1. Downscale to 8x8 grayscale (64 pixels total)
 *  2. Compute mean pixel value
 *  3. Bit i = 1 if pixel[i] >= mean else 0
 *  4. Return 64-bit hash as hex string
 */
export async function perceptualHash(filePath: string): Promise<string> {
  const { data } = await sharp(filePath)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data);
  const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  const brightnessBias = mean < 128 ? 1 : 0;

  let bits = '';
  for (const p of pixels) {
    const bit = p >= mean ? '1' : '0';
    bits += brightnessBias === 1 ? (bit === '1' ? '0' : '1') : bit;
  }

  // Pack the 64-bit binary string into a hex string.
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Hamming distance between two equal-length hex hash strings (bit-level). */
export function hammingDistance(hexA: string, hexB: string): number {
  if (hexA.length !== hexB.length) {
    // Different length hashes are not comparable; treat as maximally different.
    return Number.MAX_SAFE_INTEGER;
  }
  let distance = 0;
  for (let i = 0; i < hexA.length; i++) {
    const a = parseInt(hexA[i], 16);
    const b = parseInt(hexB[i], 16);
    let xor = a ^ b;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}
