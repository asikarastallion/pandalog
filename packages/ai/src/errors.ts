/** AI errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type AiErrorCode = 'UNPARSEABLE_ANSWER' | 'PROVIDER_FAILED' | 'INVALID_CONFIGURATION';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: AiErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
