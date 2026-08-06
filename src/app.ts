import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import imagesRouter from './routes/images';
import { prisma } from './db';
import { decodeImageData, imageDataMimeType } from './utils/imageData';
import { logger } from './utils/logger';
import { config } from './config';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve uploaded images so the frontend can display them
  app.use('/uploads', express.static(config.uploadDir));

  // Fallback for uploads wiped from Render's ephemeral disk: resolve the
  // image from the DB copy (imageData) instead of 404ing.
  app.get('/uploads/:filename', async (req: Request, res: Response) => {
    try {
      const image = await prisma.image.findFirst({
        where: { storedFilename: req.params.filename },
        select: { imageData: true, mimeType: true },
      });
      if (!image?.imageData) return res.status(404).json({ error: 'Image not found' });
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', imageDataMimeType(image.imageData));
      return res.send(decodeImageData(image.imageData));
    } catch (err) {
      logger.error('upload fallback failed', { filename: req.params.filename, error: String(err) });
      return res.status(500).json({ error: 'Failed to serve image' });
    }
  });

  // Serve the built Vite frontend (production only)
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }
  app.use(
    morgan('combined', {
      stream: { write: (msg: string) => logger.info('http', { line: msg.trim() }) },
    })
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  app.use('/images', imagesRouter);

  // SPA fallback — serve index.html for any non-API route
  app.use((req: Request, res: Response) => {
    const frontendIndex = path.resolve(__dirname, '../../frontend/dist/index.html');
    if (!req.path.startsWith('/images') && !req.path.startsWith('/health') && !req.path.startsWith('/uploads') && fs.existsSync(frontendIndex)) {
      return res.sendFile(frontendIndex);
    }
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  // Centralized error handler -- catches multer errors (file too large,
  // bad mimetype) and any synchronous throws in route handlers so a
  // single bad request can't crash the process.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err?.message?.startsWith('Unsupported file type')) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('unhandled error', { error: String(err), stack: err?.stack });
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
