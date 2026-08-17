/**
 * Canonical → display unit conversion — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §1 rule 7.
 *
 * `units.ts` maps a source unit into the canonical model. This is the other direction: canonical
 * into what a person reads. It exists here, next to that table, because rule 7 admits no exception
 * for direction — a radian-to-degree factor in a Vue component is a hard-coded conversion outside
 * `core-domain`, and the fact that it is only for display does not make it a different kind of
 * thing. `apps/web` asks for a display value; it never multiplies.
 *
 * Only three units convert. SI is already what an engineer wants to read for length, speed,
 * acceleration and pressure; it is angles and temperature where the canonical form is unreadable in
 * practice. Everything else passes through, and the identity entry is deliberate rather than a gap —
 * `DISPLAY_UNIT_OF` covers every `CanonicalUnit`, so no plot axis can render unlabelled.
 */
import { CANONICAL_UNITS, type CanonicalUnit } from '@pandalog/schema';

const RAD_TO_DEG = 180 / Math.PI;
/** 0 °C in kelvin. Temperature is affine — an offset, not a scale factor. */
const KELVIN_AT_ZERO_CELSIUS = 273.15;

export interface DisplayValue {
  readonly value: number;
  /** The unit the value is now in. Not a `CanonicalUnit`: `deg` and `degC` are display-only. */
  readonly unit: string;
}

interface DisplaySpec {
  readonly unit: string;
  readonly fromCanonical: (value: number) => number;
}

const identity = (value: number): number => value;
const scale =
  (factor: number) =>
  (value: number): number =>
    value * factor;

const DISPLAY: Partial<Record<CanonicalUnit, DisplaySpec>> = {
  rad: { unit: 'deg', fromCanonical: scale(RAD_TO_DEG) },
  'rad/s': { unit: 'deg/s', fromCanonical: scale(RAD_TO_DEG) },
  K: { unit: 'degC', fromCanonical: (value) => value - KELVIN_AT_ZERO_CELSIUS },
};

const specFor = (unit: CanonicalUnit): DisplaySpec =>
  DISPLAY[unit] ?? { unit, fromCanonical: identity };

/**
 * Convert a canonical value into the form a reader expects.
 *
 * `NaN` passes through unchanged: a sample that is not value-bearing (doc 02 §3 invariant 1b) must
 * not acquire a number on its way to a screen.
 */
export function toDisplayUnit(value: number, unit: CanonicalUnit): DisplayValue {
  const spec = specFor(unit);
  return { value: Number.isNaN(value) ? NaN : spec.fromCanonical(value), unit: spec.unit };
}

/** The unit label a canonical unit is displayed under. */
export function DISPLAY_UNIT_OF(unit: CanonicalUnit): string {
  return specFor(unit).unit;
}

/** Every canonical unit paired with its display label, for a legend or a unit picker. */
export const DISPLAY_UNITS: ReadonlyMap<CanonicalUnit, string> = new Map(
  CANONICAL_UNITS.map((unit) => [unit, DISPLAY_UNIT_OF(unit)]),
);
