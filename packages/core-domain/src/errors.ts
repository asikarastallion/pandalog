/**
 * Structured errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4.
 *
 * Every failure carries a stable `code`, a human-readable message, and enough context to act on
 * without re-running with extra logging. Callers switch on `code`, never on message text.
 */

export type CoreDomainErrorCode =
  'UNKNOWN_UNIT' | 'INVALID_TIME_BASE' | 'INVALID_SIGNAL' | 'INVALID_DATASET';

export class CoreDomainError extends Error {
  readonly code: CoreDomainErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: CoreDomainErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

/**
 * Doc 02 §3 invariant 5: an adapter that cannot map a source unit throws this; it never assumes
 * the conversion is an identity. Named in the contract, so the name is part of the API.
 */
export class UnknownUnitError extends CoreDomainError {
  readonly sourceUnit: string;

  constructor(sourceUnit: string) {
    super(
      'UNKNOWN_UNIT',
      `No canonical conversion is declared for source unit ${JSON.stringify(sourceUnit)}. ` +
        'Add an entry to the core-domain conversion table; a missing unit is never treated as an ' +
        'identity conversion (doc 02 §3 invariant 5).',
      { sourceUnit },
    );
    this.sourceUnit = sourceUnit;
  }
}

export class InvalidTimeBaseError extends CoreDomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INVALID_TIME_BASE', message, context);
  }
}

export class InvalidSignalError extends CoreDomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INVALID_SIGNAL', message, context);
  }
}

export class InvalidDatasetError extends CoreDomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INVALID_DATASET', message, context);
  }
}
