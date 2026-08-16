/**
 * Ingestion errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4.
 *
 * "Fail loudly" means a malformed log throws and produces no `CanonicalFlightDataset`. It never
 * returns a dataset with silently-dropped or silently-zeroed sections. Partial recovery, if it is
 * ever supported, will be an explicit named mode the caller opts into — not the default.
 */

export type IngestionErrorCode =
  /** No registered adapter claimed the file. */
  | 'NO_ADAPTER'
  /** Two adapters declared the same source format, or an adapter's metadata is malformed. */
  | 'DUPLICATE_ADAPTER'
  | 'ADAPTER_METADATA_INVALID'
  /** The source file is empty, so there is nothing to decode. */
  | 'EMPTY_SOURCE'
  /** The adapter threw or rejected while decoding. */
  | 'ADAPTER_FAILED'
  /** The adapter returned data that could not be assembled into a canonical dataset. */
  | 'ADAPTER_OUTPUT_INVALID'
  /** The assembled dataset failed schema validation (doc 02 §6). */
  | 'SCHEMA_INVALID'
  /** No Web Crypto implementation is available to hash the source for provenance. */
  | 'DIGEST_UNAVAILABLE';

export class IngestionError extends Error {
  readonly code: IngestionErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: IngestionErrorCode,
    message: string,
    options: { readonly context?: Record<string, unknown>; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'IngestionError';
    this.code = code;
    this.context = Object.freeze({ ...options.context });
  }
}
