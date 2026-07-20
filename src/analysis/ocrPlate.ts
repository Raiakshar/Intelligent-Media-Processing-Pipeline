import { createWorker } from 'tesseract.js';
import { CheckResult } from './types';

// Standard Indian registration plate format: SS DD LL(L) DDDD
//   SS   = 2-letter state code (e.g. KA, MH, DL)
//   DD   = 2-digit RTO code
//   L(L) = 1 or 2 letter series
//   DDDD = 4-digit unique number
// Allows an optional space/hyphen between groups since OCR + real plates
// are inconsistent about separators.
const PLATE_REGEX = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,2})[\s-]?(\d{4})\b/;

function normalizeOcrText(raw: string): string {
  // OCR commonly confuses 0/O and 1/I in this font context; we do NOT
  // silently "correct" those (that would risk turning an invalid plate
  // into a false-positive valid one) -- we only strip whitespace/noise
  // and uppercase, then regex-match against the real characters found.
  return raw.toUpperCase().replace(/[^A-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * OCR-based Indian vehicle plate extraction + format validation.
 *
 * This intentionally does NOT try to crop/locate the plate region first
 * (a proper plate-detection model is out of scope for a 48h heuristic
 * pass) -- it runs OCR on the whole frame and regex-searches the output
 * for something plate-shaped. This works reasonably well when the plate
 * is a significant, legible part of the frame, and fails gracefully
 * (reports "no plate text found") otherwise, which is the honest
 * behavior given the constraint -- see README trade-offs.
 */
export async function extractAndValidatePlate(filePath: string): Promise<CheckResult> {
  let text = '';
  try {
    const worker = await createWorker('eng');
    const result = await worker.recognize(filePath);
    text = result.data.text || '';
    await worker.terminate();
  } catch (err) {
    // OCR engine failure (corrupt image, unsupported format, etc.) should
    // not crash the whole analysis job -- report it as a check failure
    // with the reason, not throw.
    return {
      check: 'ocr_plate_validation',
      passed: false,
      severity: 'low',
      details: { error: err instanceof Error ? err.message : String(err) },
      message: 'OCR engine failed to process this image',
    };
  }

  const normalized = normalizeOcrText(text);
  const match = normalized.match(PLATE_REGEX);

  if (!match) {
    return {
      check: 'ocr_plate_validation',
      passed: false,
      severity: 'medium',
      details: { rawOcrTextLength: text.length, normalizedSample: normalized.slice(0, 120) },
      message: 'No text matching Indian vehicle plate format was found in the image',
    };
  }

  const [full, state, rto, series, number] = match;
  const plate = `${state}${rto.padStart(2, '0')}${series}${number}`;

  return {
    check: 'ocr_plate_validation',
    passed: true,
    severity: 'none',
    details: {
      extractedPlate: plate,
      stateCode: state,
      rtoCode: rto,
      seriesCode: series,
      uniqueNumber: number,
      rawMatch: full,
    },
    message: `Valid-format plate detected: ${plate}`,
  };
}
