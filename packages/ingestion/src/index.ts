/**
 * `@pandalog/ingestion` — the parser adapter contract, the adapter registry, and the bridge from a
 * source file to the canonical model (01_SYSTEM_ARCHITECTURE.md §1, §4).
 *
 * Layer 2: depends on `@pandalog/schema` and `@pandalog/core-domain`, platform neutral. It knows
 * nothing about any specific log format — that is `parser-*` territory.
 */

export type {
  ParsedFlightData,
  ParserAdapter,
  ParserAdapterMetadata,
  SourceFile,
} from './adapter.js';

export { createAdapterRegistry } from './registry.js';
export type { ParserAdapterRegistry } from './registry.js';

export { ingest } from './ingest.js';
export type { IngestOptions } from './ingest.js';

export { IngestionError } from './errors.js';
export type { IngestionErrorCode } from './errors.js';

export { sha256Hex } from './digest.js';
