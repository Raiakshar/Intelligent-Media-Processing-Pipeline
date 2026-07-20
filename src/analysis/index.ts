import { detectBlur } from './blur';
import { analyzeBrightness } from './brightness';
import { validateDimensions } from './dimensions';
import { detectDuplicate } from './duplicate';
import { detectScreenshotOrRephoto, analyzeMetadata } from './metadata';
import { detectTampering } from './tampering';
import { extractAndValidatePlate } from './ocrPlate';
import { CheckResult, AnalysisReport, Severity } from './types';
import { logger } from '../utils/logger';

export { AnalysisReport, CheckResult };

const SEVERITY_WEIGHT: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3 };

/**
 * Runs every analysis check for one image and assembles the final report.
 *
 * Design choice: each check is independently try/catch'd. One check
 * throwing (e.g. OCR engine hiccup on a corrupt file) should degrade
 * that single check to a "failed to run" result, not fail the entire
 * job and leave the other 6 checks' results unrecorded. The job is only
 * marked `failed` at the queue level for infrastructure-level problems
 * (file missing, DB unreachable) -- see queue/worker.ts.
 */
export async function runAnalysis(params: {
  imageId: string;
  filePath: string;
  sha256Hash: string;
  perceptualHash: string | null;
}): Promise<AnalysisReport> {
  const { imageId, filePath, sha256Hash, perceptualHash } = params;

  const checkDefinitions: Array<[string, () => Promise<CheckResult>]> = [
    ['blur_detection', () => detectBlur(filePath)],
    ['brightness_analysis', () => analyzeBrightness(filePath)],
    ['dimension_validation', () => validateDimensions(filePath)],
    ['duplicate_detection', () => detectDuplicate(imageId, sha256Hash, perceptualHash)],
    ['screenshot_rephoto_heuristic', () => detectScreenshotOrRephoto(filePath)],
    ['metadata_analysis', () => analyzeMetadata(filePath)],
    ['tampering_heuristic', () => detectTampering(filePath)],
    ['ocr_plate_validation', () => extractAndValidatePlate(filePath)],
  ];

  const checks: CheckResult[] = [];

  for (const [name, run] of checkDefinitions) {
    try {
      const result = await run();
      checks.push(result);
    } catch (err) {
      logger.error('analysis check threw', { imageId, check: name, error: String(err) });
      checks.push({
        check: name,
        passed: false,
        severity: 'low',
        details: { error: err instanceof Error ? err.message : String(err) },
        message: `Check "${name}" failed to execute`,
      });
    }
  }

  const issuesFound = checks.filter((c) => !c.passed).map((c) => c.check);

  // Confidence score: a simple, explainable heuristic -- not a trained
  // model. 1.0 = every check passed. Each failed check subtracts a
  // severity-weighted penalty, floored at 0. This is intentionally
  // transparent/debuggable over "more accurate but opaque"; see README.
  const totalPenalty = checks.reduce((acc, c) => acc + (c.passed ? 0 : SEVERITY_WEIGHT[c.severity]), 0);
  const maxPossiblePenalty = checks.length * SEVERITY_WEIGHT.high;
  const confidenceScore = maxPossiblePenalty === 0 ? 1 : Math.max(0, 1 - totalPenalty / maxPossiblePenalty);

  return {
    overallStatus: issuesFound.length > 0 ? 'flagged' : 'clean',
    issuesFound,
    checks,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
  };
}
