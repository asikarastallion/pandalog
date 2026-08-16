/**
 * CanonicalFlightDataset — 02_CANONICAL_DATA_MODEL.md §2.
 */
import type { Signal } from './signal.js';
import type { TimeBase } from './time.js';

/**
 * Semver of the canonical model shape defined by 02_CANONICAL_DATA_MODEL.md.
 * A breaking change to any interface in this package is a major bump (doc 02 §7).
 */
export const SCHEMA_VERSION = '1.0.0';

export interface SourceProvenance {
  readonly fileName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly format: string; // e.g. "ardupilot-dataflash"
  readonly parserPackage: string;
  readonly parserVersion: string; // semver
  readonly ingestedAtUtc: string; // ISO-8601
}

export interface Vehicle {
  /** e.g. "quad", "plane", "rover" — from source metadata, never guessed. */
  readonly frameClass: string | null;
  readonly firmwareVersion: string | null;
  readonly firmwareHash: string | null;
}

/** A discrete event carried by the source log itself (mode change, error, text message). */
export interface SourceEvent {
  readonly t_rel_seconds: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The canonical, immutable result of ingestion. Every later package operates on this shape and
 * nothing else. A CanonicalFlightDataset is never mutated after construction; derived signals,
 * events, findings, etc. reference it by id and are stored as separate artifacts.
 */
export interface CanonicalFlightDataset {
  readonly schemaVersion: string; // semver of the canonical model shape
  readonly provenance: SourceProvenance;
  readonly vehicle: Vehicle;
  readonly timeBase: TimeBase; // primary/default TimeBase for the dataset
  readonly signals: ReadonlyMap<string, Signal>;
  /** Discrete logged events carried by the source itself (mode changes, errors, messages). */
  readonly sourceEvents: readonly SourceEvent[];
}
