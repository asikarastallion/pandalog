/** Comparison errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type ComparisonErrorCode = 'INVALID_TOLERANCE' | 'INVALID_SUBJECT';

export class ComparisonError extends Error {
  readonly code: ComparisonErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: ComparisonErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ComparisonError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
