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

  // Serve uploaded images — disk first, then DB fallback for ephemeral hosts (Render)
  app.use('/uploads', express.static(config.uploadDir));
  app.get('/uploads/:filename', async (req: Request, res: Response) => {
    // This only runs if express.static above didn't find the file on disk
    const { filename } = req.params;
    try {
      const record = await getImageFileByFilename(filename);
      if (!record?.imageData) {
        return res.status(404).json({ error: 'Image not found' });
      }
      // imageData is a data URI: "data:image/jpeg;base64,<base64>"
      const [header, base64] = record.imageData.split(',');
      const mimeMatch = header.match(/data:([^;]+);base64/);
      const mimeType = mimeMatch ? mimeMatch[1] : (record.mimeType || 'image/jpeg');
      const buffer = Buffer.from(base64, 'base64');
      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=31536000');
      return res.send(buffer);
    } catch (err) {
      logger.error('failed to serve image from DB', { filename, error: String(err) });
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
