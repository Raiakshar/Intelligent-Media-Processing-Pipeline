import sharp from 'sharp';
import { CheckResult } from './types';

/**
 * Suspicious-editing heuristic via a simplified Error Level Analysis (ELA).
 *
 * Idea: re-save the JPEG at a known quality level, then diff it against
 * the original pixel-by-pixel. Untouched regions of a JPEG degrade
 * uniformly on recompression. Regions that were pasted in, cloned, or
 * heavily retouched *after* the last save were compressed a different
 * number of times than the rest of the image, so they show a distinctly
 * different (usually higher) error level -- a bright patch in the ELA
 * diff. This is the standard cheap tamper-detection trick used by tools
 * like FotoForensics, reimplemented minimally here.
 *
 * Important caveat (documented, not hidden): ELA is a heuristic that
 * flags *inconsistency*, not proof of tampering -- non-JPEG sources,
 * multiple legitimate re-saves, or heavy compression can also trigger
 * it. We report it as a signal for human review, not a verdict.
 */
export async function detectTampering(filePath: string): Promise<CheckResult> {
  const original = sharp(filePath);
  const metadata = await original.metadata();

  if (metadata.format !== 'jpeg' && metadata.format !== 'jpg') {
    // ELA is only meaningful for JPEG (its lossy block compression is
    // what creates the error-level signal). PNG/WebP source: skip cleanly.
    return {
      check: 'tampering_heuristic',
      passed: true,
      severity: 'none',
      details: { skipped: true, reason: `ELA not applicable to format "${metadata.format}"` },
      message: 'Tampering heuristic skipped -- not a JPEG source image',
    };
  }

  const QUALITY = 90;
  const originalBuffer = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const recompressedBuffer = await sharp(filePath)
    .jpeg({ quality: QUALITY })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const a = originalBuffer.data;
  const b = recompressedBuffer.data;
  const len = Math.min(a.length, b.length);

  // Compute per-pixel absolute difference, then look at how "spiky" the
  // distribution is: a uniformly-recompressed image has a fairly even,
  // low error level everywhere. A tampered region shows up as localized
  // high-error blocks well above the image's own average -- so we look
  // at the ratio of max-region-error to mean error rather than mean error
  // alone (mean alone conflates "high JPEG quality" with "no tampering").
  let sum = 0;
  let max = 0;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(a[i] - b[i]);
    sum += diff;
    if (diff > max) max = diff;
  }
  const mean = sum / len;
  const spikeRatio = mean > 0 ? max / mean : 0;

  // Threshold picked empirically for a starting point, tunable like the
  // other checks. A very high spike ratio means a small region differs
  // drastically from the rest of the image's error level.
  const SPIKE_RATIO_THRESHOLD = 40;
  const suspicious = spikeRatio > SPIKE_RATIO_THRESHOLD;

  return {
    check: 'tampering_heuristic',
    passed: !suspicious,
    severity: suspicious ? 'medium' : 'none',
    details: {
      meanErrorLevel: Math.round(mean * 1000) / 1000,
      maxErrorLevel: max,
      spikeRatio: Math.round(spikeRatio * 100) / 100,
      threshold: SPIKE_RATIO_THRESHOLD,
      recompressQuality: QUALITY,
    },
    message: suspicious
      ? `Localized compression-error spike detected (ratio ${spikeRatio.toFixed(1)} > ${SPIKE_RATIO_THRESHOLD}) -- possible localized edit, flagged for human review`
      : 'No localized compression-error anomaly detected',
  };
}
