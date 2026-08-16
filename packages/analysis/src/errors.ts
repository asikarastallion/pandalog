/** Analysis errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type AnalysisErrorCode =
  /** A Finding was constructed with no evidence — doc 03 §3's hard rule. */
  | 'MISSING_EVIDENCE'
  | 'INVALID_EVIDENCE'
  | 'INVALID_FINDING'
  | 'INVALID_HYPOTHESIS'
  | 'DUPLICATE_RULE'
  | 'INVALID_RULE';

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: AnalysisErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
