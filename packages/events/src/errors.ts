/** Events errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type EventsErrorCode = 'INVALID_EVENT' | 'DUPLICATE_DETECTOR' | 'INVALID_DETECTOR_CONFIG';

export class EventsError extends Error {
  readonly code: EventsErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: EventsErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EventsError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
