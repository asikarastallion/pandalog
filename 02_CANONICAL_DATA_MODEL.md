# 02 — Canonical Flight Data Model

Status: baseline. Owner package: `@pandalog/schema` (layer 0, zero dependencies).

This document is the contract. If code and this document disagree, this document wins until it
is amended in the same change as the code (see `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md` §Change
Control).

## 1. Why a canonical model exists

Every source format (ArduPilot DataFlash, MAVLink, TLOG, future formats) has its own message
layout, units, sample rates, and time semantics. Nothing downstream of ingestion — query,
events, analysis, verification, comparison, reporting, UI — may know any of that. Everything
downstream reads exactly one shape: the types below. An adapter's only job is to produce them.

## 2. Core types

```ts
// packages/schema/src/units.ts

/** Canonical SI (or SI-derived) unit. Every numeric Signal declares exactly one. */
export type CanonicalUnit =
  | 'm'
  | 'm/s'
  | 'm/s^2' // position, velocity, acceleration
  | 'rad'
  | 'rad/s' // angle, angular rate (radians, never degrees, in canonical form)
  | 'Pa'
  | 'Pa/s' // pressure
  | 'K' // temperature
  | 'V'
  | 'A' // electrical
  | 's' // duration
  | 'ratio' // dimensionless 0..1 (e.g. PWM duty)
  | 'percent' // dimensionless 0..100
  | 'count' // dimensionless integer quantity
  | 'unitless'; // dimensionless, no further semantics (e.g. mode enum id)

/** A source unit that a converter table knows how to map to a CanonicalUnit. */
export type SourceUnit = string; // e.g. "cdeg" (centidegrees), "deg", "mGauss", "cm/s"

export interface UnitConversion {
  sourceUnit: SourceUnit;
  canonicalUnit: CanonicalUnit;
  toCanonical: (value: number) => number;
}
```

```ts
// packages/schema/src/validity.ts

/**
 * Validity is a first-class value, never inferred from the number.
 * A sample's numeric value and its Validity are stored together and both must be read.
 */
export enum Validity {
  VALID = 'VALID',
  MISSING = 'MISSING', // no sample was logged for this instant
  INVALID = 'INVALID', // sample present but fails a declared range/sanity check
  UNSUPPORTED = 'UNSUPPORTED', // source format/firmware does not provide this signal
  INTERPOLATED = 'INTERPOLATED', // derived by resampling/interpolation, not an original sample
}

/**
 * Validity states split into two groups, and the paired numeric value follows from which group
 * the state belongs to (see §3, invariants 1a and 1b; ADR-0007).
 *
 * Value-bearing      — VALID, INTERPOLATED     — value MUST be finite, never NaN.
 * Non-value-bearing  — MISSING, INVALID, UNSUPPORTED — value MUST be NaN.
 *
 * VALID is a measurement; INTERPOLATED is a number produced by resampling/interpolation. Both are
 * usable numbers, which is why INTERPOLATED carries a finite value — forcing it to NaN would make
 * the state meaningless. NaN means, and only means, "there is genuinely no number here".
 *
 * Violating either direction is a schema violation and must fail validation (see §6).
 */
export const VALUE_BEARING_VALIDITIES: ReadonlySet<Validity> = new Set([
  Validity.VALID,
  Validity.INTERPOLATED,
]);
```

```ts
// packages/schema/src/time.ts

/**
 * Every dataset carries exactly one TimeBase describing how t_rel_seconds was produced.
 * Consumers must not assume UTC, monotonicity beyond what is declared, or synchronization
 * across two datasets without checking syncUncertaintySeconds.
 */
export type TimeOrigin =
  | 'BOOT' // t_rel_seconds = 0 at flight-controller boot
  | 'ARM' // t_rel_seconds = 0 at vehicle arm event
  | 'LOG_START' // t_rel_seconds = 0 at first record in the source file
  | 'UTC_EPOCH'; // t_rel_seconds is UTC-referenced (only when the source proves this)

export interface TimeBase {
  origin: TimeOrigin;
  /** Wall-clock UTC instant corresponding to t_rel_seconds = 0, if known. Null if unknown. */
  epochUtc: string | null; // ISO-8601
  /**
   * Estimated one-sigma uncertainty, in seconds, between this TimeBase and UTC truth.
   * null = unknown/unestablished. 0 is a real claim (e.g. GPS-disciplined) and must never be
   * used as a stand-in for "unknown".
   */
  syncUncertaintySeconds: number | null;
  /** True if the source declares a uniform sample interval; false if timestamps are sample-carried. */
  uniformlySampled: boolean;
}
```

```ts
// packages/schema/src/signal.ts

export interface Sample {
  t_rel_seconds: number;
  value: number; // finite iff validity is value-bearing (VALID | INTERPOLATED); otherwise NaN
  validity: Validity;
}

/**
 * A single named time series in canonical form. Backed by typed arrays for the numeric
 * columns (see §4); this interface is the logical shape, not the storage layout.
 */
export interface Signal {
  id: string; // stable canonical signal id, e.g. "attitude.roll"
  unit: CanonicalUnit;
  sourceUnit: SourceUnit | null; // for provenance; null if the signal is purely derived
  timeBase: TimeBase;
  samples: ReadonlyArray<Sample>;
  /** True for signals computed from other signals. Derived signals are separate artifacts (§5). */
  derived: boolean;
  /** Present when derived = true. */
  derivation?: {
    method: string; // e.g. "core-domain:lowpass-4hz"
    version: string; // semver of the derivation implementation
    inputs: string[]; // signal ids consumed
  };
}
```

```ts
// packages/schema/src/dataset.ts

export interface SourceProvenance {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  format: string; // e.g. "ardupilot-dataflash"
  parserPackage: string;
  parserVersion: string; // semver
  ingestedAtUtc: string; // ISO-8601
}

export interface Vehicle {
  frameClass: string | null; // e.g. "quad", "plane", "rover" — from source metadata, not guessed
  firmwareVersion: string | null;
  firmwareHash: string | null;
}

/**
 * The canonical, immutable result of ingestion. Every later package operates on this shape and
 * nothing else. A CanonicalFlightDataset is never mutated after construction; derived signals,
 * events, findings, etc. reference it by id and are stored as separate artifacts.
 */
export interface CanonicalFlightDataset {
  schemaVersion: string; // semver of this document's shape
  provenance: SourceProvenance;
  vehicle: Vehicle;
  timeBase: TimeBase; // primary/default TimeBase for the dataset
  signals: ReadonlyMap<string, Signal>;
  /** Discrete logged events carried by the source itself (mode changes, errors, messages). */
  sourceEvents: ReadonlyArray<{
    t_rel_seconds: number;
    type: string;
    payload: Record<string, unknown>;
  }>;
}
```

## 3. Invariants (enforced, not aspirational)

| #   | Invariant                                                                                                                                        | Enforcement                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | **Value-bearing validity** (`VALID`, `INTERPOLATED`) ⇒ `value` is finite. `NaN` or `±Infinity` here is a violation.                              | `packages/schema` runtime validator (`VALUE_BEARING_VALIDITIES`) + property test in `packages/core-domain`.                                             |
| 1b  | **Non-value-bearing validity** (`MISSING`, `INVALID`, `UNSUPPORTED`) ⇒ `value` is `NaN`. A finite number here is a violation.                    | `packages/schema` runtime validator (`VALUE_BEARING_VALIDITIES`) + property test in `packages/core-domain`.                                             |
| 2   | Every numeric `Signal` has a `CanonicalUnit`; there is no "unitless number" for a physical quantity.                                             | Type system (no optional `unit`) + adapter conformance test.                                                                                            |
| 3   | Every `CanonicalFlightDataset` has exactly one primary `TimeBase`; every `Signal` states its own `TimeBase`, which may differ if resynchronized. | Type system + core-domain construction path.                                                                                                            |
| 4   | `CanonicalFlightDataset` and `Signal` are immutable after construction (`ReadonlyArray`/`ReadonlyMap`, no exposed mutators).                     | TypeScript `readonly` + architecture test forbidding mutation helpers in `packages/schema`.                                                             |
| 5   | An adapter that cannot map a source unit throws a structured `UnknownUnitError`; it never assumes identity.                                      | `packages/core-domain` unit-conversion table is the only place `toCanonical` may be called from within ingestion.                                       |
| 6   | `sync UncertaintySeconds: 0` is a real, provable claim, never a placeholder for "unknown" (`null` is the only representation of unknown).        | Code review checklist item in `04_CLAUDE_CODE_ENGINEERING_CONTRACT.md`; adapter tests must assert the value came from a declared source, not a default. |

## 4. Storage layout (performance note, not a type change)

The interfaces above describe the _logical_ shape. Actual in-memory storage of `samples` uses
parallel typed arrays (`Float64Array` for `t_rel_seconds` and `value`, `Uint8Array` for
`validity` codes) inside `@pandalog/core-domain`, exposed through the `Signal` interface via
accessors. `packages/schema` defines the logical shape only and has no typed-array dependency,
preserving its zero-dependency, platform-neutral status.

## 5. Derived values are separate artifacts

A derived `Signal` (`derived: true`) is never written back into, or over, the source signal it
was computed from. It is stored as its own entry in `CanonicalFlightDataset.signals`, keyed by
its own `id`, carrying a `derivation` block that names the exact method, version, and inputs
used, so the derivation is reproducible from the dataset alone.

## 6. Validation

`packages/schema` exports a `validateCanonicalFlightDataset(ds): ValidationResult` pure
function checking invariants 1–4 above structurally. Ingestion (`packages/ingestion`) must run
this validator on every adapter's output before returning it; a failing dataset is a hard
ingestion error (see "Fail loudly", `01_SYSTEM_ARCHITECTURE.md` §5), never a partially-salvaged
result.

## 7. Versioning

`schemaVersion` follows semver. A breaking change to any interface in this document is a major
version bump and requires: (a) updating this document in the same change, (b) an ADR under
`docs/architecture/adr/`, (c) a migration note in `05_IMPLEMENTATION_ROADMAP.md` if any shipped
package is affected.
