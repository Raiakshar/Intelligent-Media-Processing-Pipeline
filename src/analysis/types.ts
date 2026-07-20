export type Severity = 'none' | 'low' | 'medium' | 'high';

/**
 * The uniform output shape every check returns. Keeping this consistent
 * across all 7 checks is what lets the API report results generically
 * instead of the frontend needing a special case per check type.
 */
export interface CheckResult {
  check: string;
  passed: boolean;
  severity: Severity;
  /** Free-form structured data specific to this check, for debugging/audit. */
  details: Record<string, unknown>;
  /** Human-readable summary. */
  message: string;
}

export interface AnalysisReport {
  overallStatus: 'clean' | 'flagged';
  issuesFound: string[];
  checks: CheckResult[];
  /** Simple heuristic confidence score 0-1, see analysis/index.ts */
  confidenceScore: number;
}
