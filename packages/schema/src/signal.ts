/**
 * Signal and Sample — 02_CANONICAL_DATA_MODEL.md §2.
 */
import type { TimeBase } from './time.js';
import type { CanonicalUnit, SourceUnit } from './units.js';
import type { Validity } from './validity.js';

export interface Sample {
  readonly t_rel_seconds: number;
  readonly value: number; // NaN iff validity !== VALID
  readonly validity: Validity;
}

/** Present when `Signal.derived` is true; records how the signal was computed (doc 02 §5). */
export interface SignalDerivation {
  readonly method: string; // e.g. "core-domain:lowpass-4hz"
  readonly version: string; // semver of the derivation implementation
  readonly inputs: readonly string[]; // signal ids consumed
}

/**
 * A single named time series in canonical form.
 *
 * This interface is the logical shape, not the storage layout: `@pandalog/core-domain` backs
 * `samples` with parallel typed arrays and exposes them through this interface via an accessor
 * view (doc 02 §4). `@pandalog/schema` stays free of any typed-array dependency.
 */
export interface Signal {
  readonly id: string; // stable canonical signal id, e.g. "attitude.roll"
  readonly unit: CanonicalUnit;
  readonly sourceUnit: SourceUnit | null; // for provenance; null if the signal is purely derived
  readonly timeBase: TimeBase;
  readonly samples: readonly Sample[];
  /** True for signals computed from other signals. Derived signals are separate artifacts (§5). */
  readonly derived: boolean;
  /** Present when derived = true. */
  readonly derivation?: SignalDerivation;
}
