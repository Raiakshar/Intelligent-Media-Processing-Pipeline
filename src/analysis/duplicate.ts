import { prisma } from '../db';
import { config } from '../config';
import { hammingDistance } from '../utils/hash';
import { CheckResult } from './types';

/**
 * Duplicate detection, two-tier:
 *
 *  1. Exact match on sha256 -- byte-identical re-upload. Cheap DB index
 *     lookup, zero false positives.
 *  2. Near-duplicate match on perceptual hash (aHash) -- catches the same
 *     photo re-saved/recompressed/lightly cropped. We only compare
 *     against a bounded recent window (last 500 images) rather than the
 *     whole table; see README trade-offs for why this doesn't scale to
 *     millions of rows as-is.
 *
 * Excludes the image's own row (it has already been inserted before
 * analysis runs) so it doesn't match against itself.
 */
export async function detectDuplicate(
  imageId: string,
  sha256Hash: string,
  perceptualHash: string | null
): Promise<CheckResult> {
  const exactMatch = await prisma.image.findFirst({
    where: { sha256Hash, id: { not: imageId } },
    select: { id: true, uploadedAt: true },
    orderBy: { uploadedAt: 'asc' },
  });

  if (exactMatch) {
    return {
      check: 'duplicate_detection',
      passed: false,
      severity: 'high',
      details: {
        matchType: 'exact',
        matchedImageId: exactMatch.id,
        matchedUploadedAt: exactMatch.uploadedAt,
      },
      message: `Exact duplicate of previously uploaded image ${exactMatch.id}`,
    };
  }

  if (perceptualHash) {
    const threshold = config.analysis.duplicateHammingDistanceThreshold;

    // Bounded candidate window -- see doc comment above.
    const candidates = await prisma.image.findMany({
      where: {
        id: { not: imageId },
        perceptualHash: { not: null },
      },
      select: { id: true, perceptualHash: true, uploadedAt: true },
      orderBy: { uploadedAt: 'desc' },
      take: 500,
    });

    let best: { id: string; distance: number; uploadedAt: Date } | null = null;
    for (const candidate of candidates) {
      if (!candidate.perceptualHash) continue;
      const distance = hammingDistance(perceptualHash, candidate.perceptualHash);
      if (!best || distance < best.distance) {
        best = { id: candidate.id, distance, uploadedAt: candidate.uploadedAt };
      }
    }

    if (best && best.distance <= threshold) {
      return {
        check: 'duplicate_detection',
        passed: false,
        severity: 'medium',
        details: {
          matchType: 'near_duplicate',
          matchedImageId: best.id,
          hammingDistance: best.distance,
          threshold,
        },
        message: `Likely near-duplicate of image ${best.id} (hash distance ${best.distance} <= ${threshold})`,
      };
    }
  }

  return {
    check: 'duplicate_detection',
    passed: true,
    severity: 'none',
    details: { matchType: 'none' },
    message: 'No duplicate detected',
  };
}
