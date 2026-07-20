import sharp from 'sharp';
import { config } from '../config';
import { CheckResult } from './types';

/**
 * Blur detection via variance of the Laplacian.
 *
 * A sharp image has strong edges -> high local pixel variance after a
 * Laplacian (2nd derivative) filter. A blurry image has smoothed-out
 * edges -> low variance. This is the same technique OpenCV tutorials use
 * (cv2.Laplacian(...).var()), reimplemented by hand here since we're on
 * `sharp` rather than OpenCV bindings (see README trade-offs for why).
 *
 * Steps:
 *  1. Grayscale + resize to a fixed max dimension (keeps this fast and
 *     the variance threshold comparable across differently-sized inputs).
 *  2. Convolve with a 3x3 Laplacian kernel.
 *  3. Compute variance of the resulting pixel buffer.
 */
export async function detectBlur(filePath: string): Promise<CheckResult> {
  const MAX_DIM = 800;

  const laplacianKernel = {
    width: 3,
    height: 3,
    kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  };

  const { data, info } = await sharp(filePath)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .convolve(laplacianKernel)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data);
  const n = pixels.length;
  const mean = pixels.reduce((a, b) => a + b, 0) / n;
  const variance = pixels.reduce((acc, p) => acc + (p - mean) ** 2, 0) / n;

  const threshold = config.analysis.blurVarianceThreshold;
  const isBlurry = variance < threshold;

  return {
    check: 'blur_detection',
    passed: !isBlurry,
    severity: isBlurry ? 'high' : 'none',
    details: {
      laplacianVariance: Math.round(variance * 100) / 100,
      threshold,
      resizedTo: `${info.width}x${info.height}`,
    },
    message: isBlurry
      ? `Image appears blurry (Laplacian variance ${variance.toFixed(1)} < threshold ${threshold})`
      : 'Image sharpness looks acceptable',
  };
}
