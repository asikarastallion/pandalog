/**
 * The parser adapter contract — 01_SYSTEM_ARCHITECTURE.md §4.
 *
 * This contract exists independently of any one format, which is the whole reason `ingestion` is a
 * separate package from `parser-ardupilot`. Adding MAVLink or TLOG support means adding an adapter;
 * it never means editing this file, unless the contract turns out to be wrong for *all* adapters.
 *
 * Note what an adapter does *not* supply: its own `SourceProvenance`. Hashing the bytes and
 * stamping the ingestion time are ingestion's job, so provenance records what was actually read
 * rather than what the adapter claims was read.
 */
import type { Signal, SourceEvent, TimeBase, Vehicle } from '@pandalog/schema';

/** An untrusted source file, already read into memory. */
export interface SourceFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface ParserAdapterMetadata {
  /** npm package implementing the adapter, e.g. "@pandalog/parser-ardupilot". */
  readonly packageName: string;
  /** Semver of the adapter implementation; recorded in provenance for reproducibility. */
  readonly version: string;
  /** Stable source-format identifier, e.g. "ardupilot-dataflash". Unique across the registry. */
  readonly format: string;
}

/**
 * What an adapter returns: canonical signals and metadata, with no provenance and no schema
 * version. Ingestion supplies both.
 */
export interface ParsedFlightData {
  readonly vehicle: Vehicle;
  /** Primary time base for the dataset. */
  readonly timeBase: TimeBase;
  readonly signals: readonly Signal[];
  readonly sourceEvents?: readonly SourceEvent[];
}

export interface ParserAdapter {
  readonly metadata: ParserAdapterMetadata;

  /**
   * Cheap, side-effect-free check of whether this adapter handles the file — magic bytes, an
   * extension, a header. It must not decode the whole file; `parse` does that.
   */
  canParse(file: SourceFile): boolean;

  /**
   * Decode the file into canonical signals.
   *
   * Throw a structured error on malformed input rather than returning partial data. Signals must
   * be built through `@pandalog/core-domain`'s constructors so the model's invariants hold before
   * ingestion validates them.
   */
  parse(file: SourceFile): ParsedFlightData | Promise<ParsedFlightData>;
}
