import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { buildImageDataUri, encodeImageData, decodeImageData, writeImageToDisk } from '../src/utils/imageData';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-pipeline-imagedata-'));

async function makeImage(name: string, width = 800, height = 600) {
  const filePath = path.join(tmpDir, name);
  await sharp({
    create: { width, height, channels: 3, background: '#4a90d9' },
  })
    .jpeg({ quality: 90 })
    .toFile(filePath);
  return filePath;
}

describe('imageData encode/decode helpers', () => {
  it('round-trips a buffer through encode -> decode', () => {
    const original = Buffer.from('hello world');
    const dataUri = encodeImageData(original);
    expect(dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(decodeImageData(dataUri)).toEqual(original);
  });

  it('rejects strings that are not base64 data URIs', () => {
    expect(() => decodeImageData('not-a-data-uri')).toThrow(/valid base64 data URI/);
    expect(() => decodeImageData('data:text/plain;base64,aGVsbG8=')).toThrow(/valid base64 data URI/);
  });

  it('buildImageDataUri produces a decodable JPEG data URI from a file', async () => {
    const filePath = await makeImage('sample.jpg');
    const dataUri = await buildImageDataUri(filePath);

    const decoded = decodeImageData(dataUri);
    const metadata = await sharp(decoded).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(1200);
  });

  it('writeImageToDisk reconstructs a readable file from the data URI', async () => {
    const filePath = await makeImage('reconstruct.png', 500, 400);
    const dataUri = await buildImageDataUri(filePath);

    const outPath = path.join(tmpDir, 'reconstructed.jpg');
    writeImageToDisk(outPath, dataUri);

    expect(fs.existsSync(outPath)).toBe(true);
    const metadata = await sharp(outPath).metadata();
    expect(metadata.format).toBe('jpeg');
  });
});
