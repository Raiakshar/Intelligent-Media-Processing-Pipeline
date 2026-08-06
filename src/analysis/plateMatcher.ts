/**
 * Plate matcher: converts noisy OCR output into a validated Indian
 * registration plate (format SS DD L(L) DDDD, e.g. "KA05MH1234").
 *
 * Tesseract misreads characters in predictable ways (0<->O, 1<->I/L,
 * 5<->S, 8<->B, ...), so instead of a strict regex we run a small state
 * machine over candidate substrings that:
 *   - accepts either the character OR its common OCR confusions,
 *   - skips a limited number of stray characters inside the plate,
 *   - scores each candidate and returns the most plausible one.
 */

export interface PlateMatch {
  plate: string;
  stateCode: string;
  rtoCode: string;
  seriesCode: string;
  uniqueNumber: string;
  /** The raw OCR substring the plate was parsed from. */
  rawMatch: string;
  /** Relative confidence in the extraction. */
  score: number;
  confidence: 'high' | 'medium' | 'low';
}

// Current Indian registration state/UT prefixes + Bharat series.
const VALID_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BH', 'BR', 'CH', 'CG', 'DD', 'DL', 'DN',
  'GA', 'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH',
  'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'PB', 'PY', 'RJ', 'SK', 'TN',
  'TR', 'TS', 'UK', 'UP', 'WB',
]);

// Letters that OCR frequently swaps for digits (digit -> that letter).
const DIGIT_AS_LETTER: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '4': 'A',
  '5': 'S',
  '8': 'B',
};

// Digits that OCR frequently swaps for letters (letter -> that digit).
// Kept to the most common substitutions -- the broader set (Z/2, B/8,
// G/6, T/7, A/4) produces too many false plates from ordinary English text.
const LETTER_AS_DIGIT: Record<string, string> = {
  O: '0',
  Q: '0',
  I: '1',
  L: '1',
  S: '5',
};

const isLetterLike = (c: string): boolean =>
  /[A-Z]/.test(c) || c in DIGIT_AS_LETTER;

const isDigitLike = (c: string): boolean =>
  /[0-9]/.test(c) || c in LETTER_AS_DIGIT;

function letterValue(c: string): string {
  return /[A-Z]/.test(c) ? c : DIGIT_AS_LETTER[c] ?? c;
}

function digitValue(c: string): string {
  return /[0-9]/.test(c) ? c : LETTER_AS_DIGIT[c] ?? c;
}

interface ParsedCandidate {
  plate: string;
  state: string;
  rto: string;
  series: string;
  number: string;
  raw: string;
  score: number;
}

const SEPARATOR = ' ';

/** Moves past spaces/dashes that OCR inserts between plate groups. */
function skipSeparators(text: string, i: number): number {
  while (text[i] === SEPARATOR || text[i] === '-') i++;
  return i;
}

interface ConsumeOption {
  i: number;
  value: string;
  pure: boolean;
  junk: number;
}

/**
 * Consumes 1..max token characters, returning every viable interpretation.
 * `junkBudget` stray non-token characters may be skipped before and within
 * the token (OCR noise like a stray "7" inside a letter group).
 */
function consumeToken(
  text: string,
  i: number,
  min: number,
  max: number,
  junkBudget: number,
  isLike: (c: string) => boolean,
  normalize: (c: string) => string,
  isPure: (c: string) => boolean
): ConsumeOption[] {
  const options: ConsumeOption[] = [];
  const seen = new Set<string>();
  const walk = (j: number, value: string, pure: boolean, junk: number) => {
    const at = skipSeparators(text, j);
    if (value.length >= min) {
      const key = `${at}|${value}|${pure ? 1 : 0}|${junk}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ i: at, value, pure, junk });
      }
    }
    if (value.length === max) return;
    const c = text[at];
    if (!c) return;

    if (isLike(c)) {
      walk(at + 1, value + normalize(c), pure && isPure(c), junk);
    }
    if (!isLike(c) && junk < junkBudget) {
      walk(at + 1, value, pure, junk + 1);
    }
  };

  walk(i, '', true, 0);
  return options;
}

/** Consumes 1..max characters that look like digits. */
function consumeDigits(text: string, i: number, min: number, max: number, junkBudget: number): ConsumeOption[] {
  return consumeToken(
    text,
    i,
    min,
    max,
    junkBudget,
    isDigitLike,
    digitValue,
    (c) => /[0-9]/.test(c)
  );
}

/** Same as consumeDigits but for letter-like characters. */
function consumeLetters(text: string, i: number, min: number, max: number, junkBudget: number): ConsumeOption[] {
  return consumeToken(
    text,
    i,
    min,
    max,
    junkBudget,
    isLetterLike,
    letterValue,
    (c) => /[A-Z]/.test(c)
  );
}

/**
 * Attempts to parse a plate starting at `start` in the normalized string,
 * returning every viable interpretation. A small recursive search explores
 * RTO/series lengths and stray-character skips instead of committing greedily.
 */
function parseAt(normalized: string, start: number): ParsedCandidate[] {
  const n = normalized.length;
  const results: ParsedCandidate[] = [];

  let i = skipSeparators(normalized, start);
  if (i > start) return [];

  // --- state: exactly 2 letters
  let state = '';
  for (let k = 0; k < 2; k++) {
    const c = normalized[i];
    if (!c || !isLetterLike(c)) return [];
    state += letterValue(c);
    i++;
  }
  if (!VALID_STATE_CODES.has(state)) return [];

  // --- RTO: 1-2 digits, may skip one stray char first
  const rtoOptions = consumeDigits(normalized, i, 1, 2, 1);
  for (const rto of rtoOptions) {
    const seriesOptions = consumeLetters(normalized, rto.i, 1, 2, 1);
    for (const series of seriesOptions) {
      const numberOptions = consumeDigits(normalized, series.i, 3, 4, 1);
      for (const number of numberOptions) {
        const junk = rto.junk + series.junk + number.junk;
        if (junk > 2) continue;

        let score = 0;
        if (number.value.length === 4) score += 4;
        else score += 2;
        if (rto.pure) score += 2;
        if (series.pure) score += 1;
        if (number.pure) score += 1;
        score -= junk;
        // Prefer plates that start at a token boundary (start of string or
        // right after a separator) rather than mid-token OCR garbage.
        if (start === 0 || normalized[start - 1] === SEPARATOR) score += 1;
        // Prefer parses that consume the whole remaining text -- fewer
        // leftovers means no digit was stolen from the number.
        if (number.i >= n) score += 2;

        const plate = `${state}${rto.value.padStart(2, '0')}${series.value}${number.value}`;
        results.push({
          plate,
          state,
          rto: rto.value.padStart(2, '0'),
          series: series.value,
          number: number.value,
          raw: normalized.slice(start, number.i),
          score,
        });
      }
    }
  }

  return results;
}

function normalizeText(line: string): string {
  return line.toUpperCase().replace(/[^A-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Finds the best plate candidate across all OCR lines. Lines are also
 * joined together so a plate split across two OCR text lines still matches.
 */
export function extractBestPlate(lines: string[]): PlateMatch | null {
  const normalizedLines = lines
    .filter((l) => l && l.trim())
    .map(normalizeText)
    .filter((l) => l.length > 0);

  const joined = normalizedLines.join(' ');

  const candidates: ParsedCandidate[] = [];
  const seen = new Map<string, ParsedCandidate>();

  const consider = (text: string) => {
    for (let start = 0; start < text.length; start++) {
      const found = parseAt(text, start);
      for (const cand of found) {
        const existing = seen.get(cand.plate);
        if (!existing || cand.score > existing.score) {
          seen.set(cand.plate, cand);
        }
      }
    }
  };

  consider(joined);
  for (const line of normalizedLines) consider(line);

  if (seen.size === 0) return null;

  candidates.push(...seen.values());
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Longer consumed span means more of the token matched.
    const lenA = a.raw.length;
    const lenB = b.raw.length;
    if (lenB !== lenA) return lenB - lenA;
    return 0;
  });
  const best = candidates[0];

  const confidence = best.score >= 8 ? 'high' : best.score >= 5 ? 'medium' : 'low';

  return {
    plate: best.plate,
    stateCode: best.state,
    rtoCode: best.rto,
    seriesCode: best.series,
    uniqueNumber: best.number,
    rawMatch: best.raw,
    score: best.score,
    confidence,
  };
}
