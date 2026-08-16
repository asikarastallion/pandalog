/**
 * Canonical units — 02_CANONICAL_DATA_MODEL.md §2.
 *
 * `CANONICAL_UNITS` is the single source of truth: `CanonicalUnit` is derived from it, so a unit
 * cannot be added to the type without simultaneously becoming visible to `isCanonicalUnit`. That
 * closes the gap where a type-only union silently outgrows its runtime guard.
 */

export const CANONICAL_UNITS = [
  // position, velocity, acceleration
  'm',
  'm/s',
  'm/s^2',
  // angle, angular rate (radians, never degrees, in canonical form)
  'rad',
  'rad/s',
  // pressure
  'Pa',
  'Pa/s',
  // temperature
  'K',
  // electrical
  'V',
  'A',
  // duration
  's',
  // dimensionless 0..1 (e.g. PWM duty)
  'ratio',
  // dimensionless 0..100
  'percent',
  // dimensionless integer quantity
  'count',
  // dimensionless, no further semantics (e.g. mode enum id)
  'unitless',
] as const;

/** Canonical SI (or SI-derived) unit. Every numeric Signal declares exactly one. */
export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];

const CANONICAL_UNIT_SET: ReadonlySet<string> = new Set<string>(CANONICAL_UNITS);

export function isCanonicalUnit(value: unknown): value is CanonicalUnit {
  return typeof value === 'string' && CANONICAL_UNIT_SET.has(value);
}

/** A source unit that a converter table knows how to map to a CanonicalUnit. */
export type SourceUnit = string; // e.g. "cdeg" (centidegrees), "deg", "mGauss", "cm/s"

export interface UnitConversion {
  readonly sourceUnit: SourceUnit;
  readonly canonicalUnit: CanonicalUnit;
  readonly toCanonical: (value: number) => number;
}
