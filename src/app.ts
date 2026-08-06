import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import imagesRouter from './routes/images';
import { logger } from './utils/logger';
import { config } from './config';
import { getImageFileByFilename } from './services/imageService';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve uploaded images — disk first, DB fallback for ephemeral hosts like Render.
  // Using a single middleware avoids express.static silently dropping to SPA fallback.
  app.get('/uploads/:filename', async (req: Request, res: Response, next: NextFunction) => {
    const { filename } = req.params;
    const diskPath = path.join(config.uploadDir, filename);
    // 1️⃣ Try disk first (fast path, works in local dev)
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath, { root: '/' });
    }
    // 2️⃣ Disk file missing (Render restart wiped uploads/) — serve from DB
    try {
      const record = await getImageFileByFilename(filename);
      if (!record?.imageData) {
        return res.status(404).json({ error: 'Image not found' });
      }
      // imageData stored as "data:image/jpeg;base64,<base64>"
      const commaIdx = record.imageData.indexOf(',');
      const header   = record.imageData.slice(0, commaIdx);
      const base64   = record.imageData.slice(commaIdx + 1);
      const mimeMatch = header.match(/data:([^;]+);base64/);
      const mimeType  = mimeMatch ? mimeMatch[1] : (record.mimeType || 'image/jpeg');
      const buffer    = Buffer.from(base64, 'base64');
      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(buffer);
    } catch (err) {
      logger.error('failed to serve image from DB', { filename, error: String(err) });
      return next(err);
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
