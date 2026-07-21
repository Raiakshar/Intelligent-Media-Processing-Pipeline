import multer from 'multer';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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

export const upload = multer({
  storage: multer.memoryStorage(),

  fileFilter,

  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});