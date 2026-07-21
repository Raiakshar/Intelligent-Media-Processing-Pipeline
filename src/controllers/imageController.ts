import { Request, Response } from 'express';
import { z } from 'zod';
import { createImageRecord, getImageById, listImages } from '../services/imageService';
import { logger } from '../utils/logger';

export async function uploadImage(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided. Use multipart/form-data with field name "image".' });
  }
  try {
    const image = await createImageRecord({
      originalName: req.file.originalname,
      storedFilename: req.file.filename,
      storagePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    // Return the processing ID immediately -- analysis has NOT run yet.
    return res.status(202).json({
      id: image.id,
      status: image.status,
      uploadedAt: image.uploadedAt,
      message: 'Image accepted and queued for processing.',
    });
  } catch (err) {
    logger.error('upload failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to process upload' });
  }
}

const idParamSchema = z.object({ id: z.string().uuid() });

export async function getStatus(req: Request, res: Response) {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid image id' });

  const image = await getImageById(parsed.data.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  return res.json({
    id: image.id,
    status: image.status,
    attempts: image.attempts,
    uploadedAt: image.uploadedAt,
    processingStartedAt: image.processingStartedAt,
    processedAt: image.processedAt,
    ...(image.status === 'failed' ? { failureReason: image.failureReason } : {}),
  });
}

export async function getResults(req: Request, res: Response) {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid image id' });

  const image = await getImageById(parsed.data.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  if (image.status !== 'completed') {
    return res.status(409).json({
      error: `Analysis not yet complete (current status: ${image.status})`,
      status: image.status,
      ...(image.status === 'failed' ? { failureReason: image.failureReason } : {}),
    });
  }

  return res.json({
    id: image.id,
    status: image.status,
    processedAt: image.processedAt,
    analysis: image.analysisResult,
  });
}

export async function getFailureReason(req: Request, res: Response) {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid image id' });

  const image = await getImageById(parsed.data.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  if (image.status !== 'failed') {
    return res.status(409).json({ error: `Image has not failed (current status: ${image.status})` });
  }

  return res.json({
    id: image.id,
    status: image.status,
    attempts: image.attempts,
    failureReason: image.failureReason,
  });
}

export async function listImagesHandler(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  const { items, total } = await listImages({ status, limit, offset });
  return res.json({ items, total, limit, offset });
}
