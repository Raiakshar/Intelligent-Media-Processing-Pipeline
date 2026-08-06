import fs from 'fs';
import sharp from 'sharp';

/**
 * Uploaded files are stored on disk, but Render wipes its ephemeral
 * filesystem whenever the service restarts. To keep images available
 * permanently we also persist a compressed copy in Postgres as a base64
 * data URI (`data:image/jpeg;base64,...`) in the `imageData` column.
 *
 * This module owns the encode/decode boundary so both the upload path
 * (createImageRecord) and the worker's disk-reconstruction path share
 * exactly one implementation.
 */

const MAX_PREVIEW_WIDTH = 1200;
const PREVIEW_QUALITY = 80;

/** Compress the uploaded file into a base64 JPEG data URI for DB storage. */
export async function buildImageDataUri(filePath: string): Promise<string> {
  const buffer = await sharp(filePath)
    .resize({ width: MAX_PREVIEW_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: PREVIEW_QUALITY })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

export function encodeImageData(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

export function decodeImageData(dataUri: string): Buffer {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUri.trim());
  if (!match) {
    throw new Error('imageData is not a valid base64 data URI');
  }
  return Buffer.from(match[1], 'base64');
}

/** Mime type embedded in the data URI (e.g. "image/jpeg"). */
export function imageDataMimeType(dataUri: string): string {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUri.trim());
  return match ? match[1] : 'image/jpeg';
}

/**
 * Writes the DB-stored image back to `storagePath`. Used by the worker
 * when Render's disk wipe has removed the original upload but analysis
 * still needs a file to read.
 */
export function writeImageToDisk(storagePath: string, imageData: string): void {
  const buffer = decodeImageData(imageData);
  fs.writeFileSync(storagePath, buffer);
}
