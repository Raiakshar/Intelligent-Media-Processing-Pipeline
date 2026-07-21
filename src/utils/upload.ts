import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import { config } from '../config';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      fs.mkdirSync(config.uploadDir, { recursive: true });
      cb(null, config.uploadDir);
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)), config.uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    // Never derive the on-disk name from client input. This avoids path and
    // filename collisions while retaining a media-type-appropriate extension.
    cb(null, `${crypto.randomUUID()}${EXTENSION_BY_MIME_TYPE[file.mimetype]}`);
  },
});

export const upload = multer({
  storage,

  fileFilter,

  limits: {
    fileSize: config.maxUploadSizeMb * 1024 * 1024,
  },
});
