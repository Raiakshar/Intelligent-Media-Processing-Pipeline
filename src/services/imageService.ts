import fs from 'fs';
import sharp from 'sharp';
import { prisma } from '../db';
import { imageAnalysisQueue } from '../queue/queue';
import { sha256File, perceptualHash as computePHash } from '../utils/hash';
import { logger } from '../utils/logger';

export interface UploadedFileInfo {
  originalName: string;
  storedFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Creates the DB row for an uploaded image, enqueues the async analysis
 * job, and returns the row. Perceptual hashing happens synchronously
 * here (before enqueue) rather than in the worker, because the
 * duplicate-detection check inside the job needs it available for
 * *other* jobs to compare against as soon as possible -- if we deferred
 * it to the worker, two images uploaded back-to-back could race and
 * neither would see the other's hash yet. Hashing a single image is
 * fast (<50ms typically); OCR is the actually slow part, and that stays
 * in the async job.
 */
export async function createImageRecord(file: UploadedFileInfo) {
  const sha256Hash = sha256File(file.storagePath);

  let perceptualHashValue: string | null = null;
  try {
    perceptualHashValue = await computePHash(file.storagePath);
  } catch (err) {
    // Non-fatal: some inputs (e.g. corrupt image) may fail hashing.
    // Duplicate detection will simply skip the near-duplicate tier.
    logger.warn('perceptual hash computation failed', { error: String(err) });
  }

  let imageDataBase64: string | null = null;
  try {
    const fileBuffer = fs.readFileSync(file.storagePath);
    const compressedBuffer = await sharp(fileBuffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    imageDataBase64 = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
  } catch (err) {
    logger.warn('failed to store base64 image data', { error: String(err) });
  }

  const image = await prisma.image.create({
    data: {
      originalName: file.originalName,
      storedFilename: file.storedFilename,
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256Hash,
      perceptualHash: perceptualHashValue,
      imageData: imageDataBase64,
      status: 'processing',
      processingStartedAt: new Date(),
    },
  });

  // Try queuing in BullMQ (if Redis active)
  try {
    await imageAnalysisQueue.add(
      'analyze',
      { imageId: image.id },
      { jobId: image.id }
    );
  } catch { /* ignore Redis queue connection issue */ }

  // Execute analysis synchronously inline so results are instant and never stuck pending
  try {
    const { runAnalysis } = await import('../analysis');
    const report = await runAnalysis({
      imageId: image.id,
      filePath: file.storagePath,
      sha256Hash,
      perceptualHash: perceptualHashValue,
    });

    const updated = await prisma.image.update({
      where: { id: image.id },
      data: {
        status: 'completed',
        processedAt: new Date(),
        analysisResult: report as any,
      },
    });
    return updated;
  } catch (err) {
    logger.error('sync analysis failed', { imageId: image.id, error: String(err) });
    const updated = await prisma.image.update({
      where: { id: image.id },
      data: {
        status: 'failed',
        failureReason: String(err).slice(0, 500),
        processedAt: new Date(),
      },
    });
    return updated;
  }
}

export async function getImageById(imageId: string) {
  return prisma.image.findUnique({ where: { id: imageId } });
}

export async function listImages(params: { status?: string; limit: number; offset: number }) {
  const where = params.status ? { status: params.status as any } : {};
  const [items, total] = await Promise.all([
    prisma.image.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      select: {
        id: true,
        originalName: true,
        storedFilename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        attempts: true,
        uploadedAt: true,
        processedAt: true,
        failureReason: true,
        analysisResult: true,
        imageData: true,   // base64 data URI — used by frontend for permanent image display
      },
    }),
    prisma.image.count({ where }),
  ]);
  return { items, total };
}

export async function clearAllImages() {
  const images = await prisma.image.findMany({ select: { storagePath: true } });
  for (const img of images) {
    try {
      if (img.storagePath && fs.existsSync(img.storagePath)) {
        fs.unlinkSync(img.storagePath);
      }
    } catch {
      /* ignore file deletion errors */
    }
  }
  await prisma.image.deleteMany({});
  logger.info('all images cleared from database and storage');
}

export async function getImageFileByFilename(storedFilename: string) {
  return prisma.image.findFirst({
    where: { storedFilename },
    select: { storagePath: true, mimeType: true, imageData: true },
  });
}


