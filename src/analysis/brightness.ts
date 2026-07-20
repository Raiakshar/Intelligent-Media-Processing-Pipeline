import sharp from 'sharp';
import { config } from '../config';
import { CheckResult } from './types';

/**
 * Brightness analysis via mean pixel intensity of the grayscale image
 * (0-255 scale). Flags both under-exposed (low light) and blown-out
 * (over-exposed) images -- both make a vehicle image hard to verify.
 */
export async function analyzeBrightness(filePath: string): Promise<CheckResult> {
  const stats = await sharp(filePath).grayscale().stats();
  const mean = stats.channels[0].mean;

  const { brightnessLowThreshold: low, brightnessHighThreshold: high } = config.analysis;

  let issue: 'low_light' | 'overexposed' | null = null;
  if (mean < low) issue = 'low_light';
  else if (mean > high) issue = 'overexposed';

  return {
    check: 'brightness_analysis',
    passed: issue === null,
    severity: issue ? 'medium' : 'none',
    details: {
      meanBrightness: Math.round(mean * 100) / 100,
      lowThreshold: low,
      highThreshold: high,
    },
    message:
      issue === 'low_light'
        ? `Image appears too dark (mean brightness ${mean.toFixed(1)} < ${low})`
        : issue === 'overexposed'
        ? `Image appears overexposed/washed out (mean brightness ${mean.toFixed(1)} > ${high})`
        : 'Brightness looks acceptable',
  };
}
