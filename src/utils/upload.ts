import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { put } from '@vercel/blob';
import { config } from '../config';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

fs.mkdirSync(config.uploadDir, { recursive: true });

function fileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(
      new Error(
        'Unsupported file type. Only JPEG, PNG and WEBP images are allowed.'
      )
    );
  }

  cb(null, true);
}

function generateFilename(originalName: string) {
  const ext = path.extname(originalName || '').toLowerCase();
  const base = path
    .basename(originalName || 'upload', ext)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .toLowerCase();
  const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${base}-${suffix}${ext}`;
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, generateFilename(file.originalname));
  },
});

const memoryStorage = multer.memoryStorage();

const uploadMiddleware = multer({
  storage: process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN ? memoryStorage : diskStorage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
}).single('image');

export const upload = (req: any, res: any, next: any) => {
  uploadMiddleware(req, res, async (err: any) => {
    if (err) return next(err);

    if (!req.file) return next();

    if (process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN && req.file.buffer) {
      const filename = generateFilename(req.file.originalname || 'upload');
      const tempFilePath = path.join(config.uploadDir, filename);
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, req.file.buffer);

      const blob = await put(filename, req.file.buffer, {
        access: 'public',
        contentType: req.file.mimetype,
      });

      req.file.filename = filename;
      req.file.path = blob.url;
      req.file.analysisFilePath = tempFilePath;
      req.file.storageUrl = blob.url;
      req.file.size = req.file.buffer.byteLength;
    }

    next();
  });
};