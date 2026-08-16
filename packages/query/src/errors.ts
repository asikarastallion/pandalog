/** Query errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4. */

export type QueryErrorCode =
  /** Alignment was asked to combine signals whose time origins differ with no stated sync. */
  | 'UNKNOWN_SYNCHRONISATION'
  /** A resample grid was not finite and strictly increasing. */
  | 'INVALID_GRID'
  /** A derivation was asked for that is not registered. */
  | 'UNKNOWN_DERIVATION'
  /** A derivation's inputs do not satisfy its declared requirements. */
  | 'INVALID_DERIVATION_INPUT'
  /** Two derivations registered under the same method name. */
  | 'DUPLICATE_DERIVATION';

export class QueryError extends Error {
  readonly code: QueryErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: QueryErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'QueryError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
