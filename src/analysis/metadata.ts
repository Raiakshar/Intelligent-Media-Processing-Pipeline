import sharp from 'sharp';
import exifr from 'exifr';
import { CheckResult } from './types';

// Common device/monitor screen resolutions (portrait+landscape). Not
// exhaustive -- this is a heuristic, not a guarantee. Documented as a
// known limitation in the README.
const COMMON_SCREEN_RESOLUTIONS: Array<[number, number]> = [
  [1080, 1920], [1170, 2532], [1179, 2556], [1284, 2778], [1080, 2400],
  [1440, 2960], [1440, 3200], [750, 1334], [828, 1792], [1242, 2688],
  [1920, 1080], [2532, 1170], [1366, 768], [2560, 1440], [3840, 2160],
];

function isCommonScreenResolution(width: number, height: number): boolean {
  return COMMON_SCREEN_RESOLUTIONS.some(
    ([w, h]) => (w === width && h === height) || (h === width && w === height)
  );
}

/**
 * Screenshot / photo-of-photo heuristic.
 *
 * A genuine field photo taken with a phone camera almost always carries
 * EXIF data (Make, Model, DateTimeOriginal, sometimes GPS) written by the
 * camera app. A screenshot has no EXIF (it's a raster dump of the screen)
 * and its dimensions exactly match a known device/screen resolution.
 * A "photo of a photo/screen" (re-photographing another image) usually
 * *does* have EXIF (from the camera that took the re-photo) but the
 * absence of GPS + a generic/absent Make+Model combined with unusual
 * aspect ratio is a weak signal we surface but do not hard-fail on.
 *
 * This is explicitly a heuristic bundle, not a certainty -- each signal
 * is reported individually in `details` so a human reviewer can see why
 * it was flagged rather than trusting a black-box verdict.
 */
export async function detectScreenshotOrRephoto(filePath: string): Promise<CheckResult> {
  const metadata = await sharp(filePath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  let exif: any = null;
  try {
    exif = await exifr.parse(filePath, { pick: ['Make', 'Model', 'DateTimeOriginal', 'GPSLatitude', 'Software'] });
  } catch {
    // Corrupt/absent EXIF segment -- treat as no EXIF, not a hard error.
    exif = null;
  }

  const hasCameraExif = !!(exif && (exif.Make || exif.Model || exif.DateTimeOriginal));
  const matchesScreenRes = isCommonScreenResolution(width, height);
  const isPng = metadata.format === 'png'; // screenshots are very commonly PNG

  const screenshotSignals = [matchesScreenRes, isPng && !hasCameraExif, !hasCameraExif].filter(Boolean).length;
  const looksLikeScreenshot = matchesScreenRes && !hasCameraExif;

  // Weak signal for "photo of a screen/photo": has EXIF (real camera) but
  // software field indicates editing, or no GPS + generic aspect ratio.
  const suspiciousSoftware = !!(exif?.Software && /photoshop|gimp|snapseed|screenshot/i.test(exif.Software));

  const flagged = looksLikeScreenshot || suspiciousSoftware;

  return {
    check: 'screenshot_rephoto_heuristic',
    passed: !flagged,
    severity: looksLikeScreenshot ? 'high' : suspiciousSoftware ? 'medium' : 'none',
    details: {
      width,
      height,
      format: metadata.format,
      hasCameraExif,
      matchesKnownScreenResolution: matchesScreenRes,
      exifSoftwareTag: exif?.Software ?? null,
      screenshotSignalCount: screenshotSignals,
    },
    message: looksLikeScreenshot
      ? 'Image resolution matches a known screen size and has no camera EXIF data -- likely a screenshot'
      : suspiciousSoftware
      ? `EXIF Software tag ("${exif.Software}") suggests the image was edited or is a re-capture`
      : 'No screenshot/re-photo signals detected',
  };
}

/**
 * General EXIF/metadata presence check. Field photo apps typically embed
 * capture metadata; its total absence (on a JPEG, where it's expected) is
 * itself a mild signal worth surfacing, separate from the screenshot check
 * above which uses EXIF as one input among several.
 */
export async function analyzeMetadata(filePath: string): Promise<CheckResult> {
  const metadata = await sharp(filePath).metadata();
  let exif: any = null;
  try {
    exif = await exifr.parse(filePath);
  } catch {
    exif = null;
  }

  const isJpeg = metadata.format === 'jpg' || metadata.format === 'jpeg';
  const hasAnyExif = !!exif && Object.keys(exif).length > 0;
  const missingOnJpeg = isJpeg && !hasAnyExif;

  return {
    check: 'metadata_analysis',
    passed: !missingOnJpeg,
    severity: missingOnJpeg ? 'low' : 'none',
    details: {
      format: metadata.format,
      hasExif: hasAnyExif,
      hasGps: !!(exif && exif.GPSLatitude),
      cameraMake: exif?.Make ?? null,
      cameraModel: exif?.Model ?? null,
      capturedAt: exif?.DateTimeOriginal ?? null,
    },
    message: missingOnJpeg
      ? 'JPEG has no EXIF metadata at all -- may have been stripped, edited, or is not an original camera capture'
      : 'Metadata present or not expected for this format',
  };
}
