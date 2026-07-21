import fs from 'fs';
import { prisma } from '../db';
import { runAnalysis } from '../analysis';
import { imageAnalysisQueue } from '../queue/queue';
import { sha256File, perceptualHash as computePHash } from '../utils/hash';
import { logger } from '../utils/logger';

export interface UploadedFileInfo {
  originalName: string;
  storedFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  analysisFilePath?: string;
  storageUrl?: string;
}

async function processImageAnalysis(imageId: string, storagePath: string, sha256Hash: string, perceptualHashValue: string | null) {
  await prisma.image.update({
    where: { id: imageId },
    data: {
      status: 'processing',
      processingStartedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  const report = await runAnalysis({
    imageId,
    filePath: storagePath,
    sha256Hash,
    perceptualHash: perceptualHashValue,
  });

  await prisma.image.update({
    where: { id: imageId },
    data: {
      status: 'completed',
      processedAt: new Date(),
      analysisResult: report as any,
    },
  });
}

/**
 * Creates the DB row for an uploaded image and either enqueues the async
 * analysis job (local development) or processes it inline in the request
 * when running in Vercel/serverless mode.
 */
export async function createImageRecord(file: UploadedFileInfo) {
  const analysisFilePath = file.analysisFilePath || file.storagePath;
  const storagePathForDb = file.storageUrl || file.storagePath;

  const sha256Hash = sha256File(analysisFilePath);

  let perceptualHashValue: string | null = null;
  try {
    perceptualHashValue = await computePHash(analysisFilePath);
  } catch (err) {
    logger.warn('perceptual hash computation failed', { error: String(err) });
  }

  const image = await prisma.image.create({
    data: {
      originalName: file.originalName,
      storedFilename: file.storedFilename,
      storagePath: storagePathForDb,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256Hash,
      perceptualHash: perceptualHashValue,
      status: 'pending',
    },
  });

  const isVercelRuntime = Boolean(process.env.VERCEL);

  if (isVercelRuntime) {
    try {
      await processImageAnalysis(image.id, analysisFilePath, sha256Hash, perceptualHashValue);
      logger.info('image processed inline for vercel deployment', { imageId: image.id, originalName: file.originalName });
    } catch (err) {
      logger.error('inline image processing failed', { imageId: image.id, error: String(err) });
      await prisma.image.update({
        where: { id: image.id },
        data: {
          status: 'failed',
          failureReason: err instanceof Error ? err.message : String(err),
          processedAt: new Date(),
        },
      });
    }
  } else if (imageAnalysisQueue) {
    await imageAnalysisQueue.add(
      'analyze',
      { imageId: image.id },
      { jobId: image.id }
    );

    logger.info('image uploaded and queued', { imageId: image.id, originalName: file.originalName });
  }

  if (file.analysisFilePath && file.analysisFilePath !== file.storagePath) {
    try {
      fs.unlinkSync(file.analysisFilePath);
    } catch (cleanupErr) {
      logger.warn('temp upload cleanup failed', { error: String(cleanupErr) });
    }
  }

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
