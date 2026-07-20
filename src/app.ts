import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import imagesRouter from './routes/images';
import { logger } from './utils/logger';
import { config } from './config';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve uploaded images so the frontend can display them
  app.use('/uploads', express.static(config.uploadDir));
  app.use(
    morgan('combined', {
      stream: { write: (msg: string) => logger.info('http', { line: msg.trim() }) },
    })
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  app.use('/images', imagesRouter);

  app.use((req: Request, res: Response) => {
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
