/** Reporting errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type ReportingErrorCode = 'INVALID_INPUT';

export class ReportingError extends Error {
  readonly code: ReportingErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: ReportingErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ReportingError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
