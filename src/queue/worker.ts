import { Worker, Job } from 'bullmq';
import { redisConnection, IMAGE_ANALYSIS_QUEUE, ImageAnalysisJobData } from './queue';
import { prisma } from '../db';
import { runAnalysis } from '../analysis';
import { logger } from '../utils/logger';
import fs from 'fs';

/**
 * Runs as a separate process from the API server (`npm run dev:worker` /
 * `npm run start:worker`). This is a deliberate architectural choice:
 * the HTTP server should stay responsive to accept uploads even while
 * image analysis (OCR especially can take a few seconds) is CPU-bound
 * elsewhere. `concurrency` bounds how many jobs this worker processes
 * in parallel -- tune based on CPU cores available; OCR is the
 * expensive step here.
 */
const CONCURRENCY = 2;

async function processJob(job: Job<ImageAnalysisJobData>) {
  const { imageId } = job.data;

  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) {
    // Job refers to a row that no longer exists -- don't retry forever.
    throw new Error(`Image ${imageId} not found in database`);
  }

  if (!fs.existsSync(image.storagePath)) {
    throw new Error(`Stored file missing on disk: ${image.storagePath}`);
  }

  await prisma.image.update({
    where: { id: imageId },
    data: {
      status: 'processing',
      processingStartedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  logger.info('processing image', { imageId, attempt: job.attemptsMade + 1 });

  const report = await runAnalysis({
    imageId,
    filePath: image.storagePath,
    sha256Hash: image.sha256Hash,
    perceptualHash: image.perceptualHash,
  });

  await prisma.image.update({
    where: { id: imageId },
    data: {
      status: 'completed',
      processedAt: new Date(),
      analysisResult: report as any,
    },
  });

  logger.info('image processing completed', {
    imageId,
    overallStatus: report.overallStatus,
    issuesFound: report.issuesFound,
  });
}

if (!redisConnection) {
  throw new Error('Redis connection is required for the worker process');
}

const worker = new Worker<ImageAnalysisJobData>(
  IMAGE_ANALYSIS_QUEUE,
  processJob,
  { connection: redisConnection, concurrency: CONCURRENCY }
);

worker.on('completed', (job) => {
  logger.info('job completed', { jobId: job.id, imageId: job.data.imageId });
});

// Only mark the DB row `failed` once BullMQ has exhausted all retry
// attempts (job.attemptsMade === job.opts.attempts). Intermediate
// retries should stay invisible to the API consumer as far as final
// status goes -- though `attempts` on the row lets us report retry count.
worker.on('failed', async (job, err) => {
  if (!job) return;
  const attemptsMade = job.attemptsMade;
  const maxAttempts = job.opts.attempts ?? 1;

  logger.error('job failed', {
    jobId: job.id,
    imageId: job.data.imageId,
    attemptsMade,
    maxAttempts,
    error: err.message,
  });

  if (attemptsMade >= maxAttempts) {
    await prisma.image.update({
      where: { id: job.data.imageId },
      data: {
        status: 'failed',
        failureReason: err.message.slice(0, 500),
        processedAt: new Date(),
      },
    }).catch((dbErr) => {
      logger.error('failed to persist failure state', { imageId: job.data.imageId, error: String(dbErr) });
    });
  }
});

logger.info('worker started', { queue: IMAGE_ANALYSIS_QUEUE, concurrency: CONCURRENCY });

process.on('SIGTERM', async () => {
  logger.info('worker shutting down (SIGTERM)');
  await worker.close();
  process.exit(0);
});
