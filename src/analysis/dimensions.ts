import sharp from 'sharp';
import { config } from '../config';
import { CheckResult } from './types';

/**
 * Validates the image meets a minimum usable resolution. Vehicle images
 * below this resolution are usually unusable for plate/damage review
 * regardless of what other checks say.
 */
export async function validateDimensions(filePath: string): Promise<CheckResult> {
  const metadata = await sharp(filePath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const { minImageWidth, minImageHeight } = config.analysis;
  const tooSmall = width < minImageWidth || height < minImageHeight;

  return {
    check: 'dimension_validation',
    passed: !tooSmall,
    severity: tooSmall ? 'high' : 'none',
    details: {
      width,
      height,
      minRequired: `${minImageWidth}x${minImageHeight}`,
    },
    message: tooSmall
      ? `Image resolution ${width}x${height} is below the minimum ${minImageWidth}x${minImageHeight}`
      : `Image resolution ${width}x${height} is acceptable`,
  };
}
