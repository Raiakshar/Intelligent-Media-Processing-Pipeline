import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num('PORT', 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadSizeMb: num('MAX_UPLOAD_SIZE_MB', 15),

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: num('REDIS_PORT', 6379),
  },

  analysis: {
    blurVarianceThreshold: num('BLUR_VARIANCE_THRESHOLD', 100),
    brightnessLowThreshold: num('BRIGHTNESS_LOW_THRESHOLD', 60),
    brightnessHighThreshold: num('BRIGHTNESS_HIGH_THRESHOLD', 200),
    duplicateHammingDistanceThreshold: num('DUPLICATE_HAMMING_DISTANCE_THRESHOLD', 5),
    minImageWidth: num('MIN_IMAGE_WIDTH', 400),
    minImageHeight: num('MIN_IMAGE_HEIGHT', 300),
  },
};
