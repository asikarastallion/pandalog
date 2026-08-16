/** Verification errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type VerificationErrorCode =
  'INVALID_RESULT' | 'INVALID_EVIDENCE' | 'INVALID_REQUIREMENT' | 'INVALID_REQUIREMENT_SET';

export class VerificationError extends Error {
  readonly code: VerificationErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: VerificationErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
