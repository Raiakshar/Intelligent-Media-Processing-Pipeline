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

  const image = await prisma.image.create({
    data: {
      originalName: file.originalName,
      storedFilename: file.storedFilename,
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256Hash,
      perceptualHash: perceptualHashValue,
      status: 'pending',
    },
  });

  await imageAnalysisQueue.add(
    'analyze',
    { imageId: image.id },
    { jobId: image.id } // idempotency: one job per image id, prevents accidental double-enqueue
  );

  logger.info('image uploaded and queued', { imageId: image.id, originalName: file.originalName });

  return image;
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
      },
    }),
    prisma.image.count({ where }),
  ]);
  return { items, total };
}
