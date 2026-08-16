/**
 * The unit conversion table — 01_SYSTEM_ARCHITECTURE.md §7, 02_CANONICAL_DATA_MODEL.md §3
 * invariant 5, 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §1 rule 7.
 *
 * This is the only place in the system where a source unit becomes a canonical one. No other
 * package may hard-code a conversion factor. A source unit that is not in this table throws
 * `UnknownUnitError` — it is never passed through on the assumption that the numbers happen to
 * line up, because that assumption is how a centidegree silently becomes a radian.
 *
 * Every factor below is a named constant rather than an inline literal (doc 04, "Magic Numbers"),
 * so a wrong conversion is visible as a wrong name, not a wrong digit.
 */
import type { CanonicalUnit, SourceUnit, UnitConversion } from '@pandalog/schema';

import { UnknownUnitError } from './errors.js';

const DEG_TO_RAD = Math.PI / 180;
const CENTI = 1e-2;
const MILLI = 1e-3;
const MICRO = 1e-6;
const KILO = 1e3;

/** CODATA/ISO standard gravity. */
const STANDARD_GRAVITY_M_PER_S2 = 9.80665;
/** 0 °C expressed in kelvin. Temperature is affine: an offset, not a scale factor. */
const KELVIN_AT_ZERO_CELSIUS = 273.15;
const KM_PER_HOUR_TO_M_PER_S = KILO / 3600;
const HECTOPASCAL_TO_PASCAL = 100;
const KILOPASCAL_TO_PASCAL = KILO;

const identity = (value: number): number => value;
const scale =
  (factor: number) =>
  (value: number): number =>
    value * factor;

interface ConversionSpec {
  readonly canonicalUnit: CanonicalUnit;
  readonly toCanonical: (value: number) => number;
}

/**
 * Source unit -> canonical conversion.
 *
 * Source units are matched exactly, case-sensitively: "deg" and "DEG" are not the same token, and
 * guessing between them is precisely the kind of assumption this table exists to prevent.
 */
const CONVERSIONS = {
  // length -> m
  m: { canonicalUnit: 'm', toCanonical: identity },
  cm: { canonicalUnit: 'm', toCanonical: scale(CENTI) },
  mm: { canonicalUnit: 'm', toCanonical: scale(MILLI) },
  km: { canonicalUnit: 'm', toCanonical: scale(KILO) },

  // velocity -> m/s
  'm/s': { canonicalUnit: 'm/s', toCanonical: identity },
  'cm/s': { canonicalUnit: 'm/s', toCanonical: scale(CENTI) },
  'mm/s': { canonicalUnit: 'm/s', toCanonical: scale(MILLI) },
  'km/h': { canonicalUnit: 'm/s', toCanonical: scale(KM_PER_HOUR_TO_M_PER_S) },

  // acceleration -> m/s^2
  'm/s^2': { canonicalUnit: 'm/s^2', toCanonical: identity },
  'cm/s^2': { canonicalUnit: 'm/s^2', toCanonical: scale(CENTI) },
  'mm/s^2': { canonicalUnit: 'm/s^2', toCanonical: scale(MILLI) },
  g: { canonicalUnit: 'm/s^2', toCanonical: scale(STANDARD_GRAVITY_M_PER_S2) },

  // angle -> rad
  rad: { canonicalUnit: 'rad', toCanonical: identity },
  deg: { canonicalUnit: 'rad', toCanonical: scale(DEG_TO_RAD) },
  cdeg: { canonicalUnit: 'rad', toCanonical: scale(CENTI * DEG_TO_RAD) },

  // angular rate -> rad/s
  'rad/s': { canonicalUnit: 'rad/s', toCanonical: identity },
  'deg/s': { canonicalUnit: 'rad/s', toCanonical: scale(DEG_TO_RAD) },
  'cdeg/s': { canonicalUnit: 'rad/s', toCanonical: scale(CENTI * DEG_TO_RAD) },

  // pressure -> Pa
  Pa: { canonicalUnit: 'Pa', toCanonical: identity },
  hPa: { canonicalUnit: 'Pa', toCanonical: scale(HECTOPASCAL_TO_PASCAL) },
  mbar: { canonicalUnit: 'Pa', toCanonical: scale(HECTOPASCAL_TO_PASCAL) },
  kPa: { canonicalUnit: 'Pa', toCanonical: scale(KILOPASCAL_TO_PASCAL) },

  // temperature -> K. Affine, not a scale: 0 degC is 273.15 K, not 0 K.
  K: { canonicalUnit: 'K', toCanonical: identity },
  degC: { canonicalUnit: 'K', toCanonical: (value) => value + KELVIN_AT_ZERO_CELSIUS },
  cdegC: { canonicalUnit: 'K', toCanonical: (value) => value * CENTI + KELVIN_AT_ZERO_CELSIUS },

  // electrical -> V / A
  V: { canonicalUnit: 'V', toCanonical: identity },
  mV: { canonicalUnit: 'V', toCanonical: scale(MILLI) },
  cV: { canonicalUnit: 'V', toCanonical: scale(CENTI) },
  A: { canonicalUnit: 'A', toCanonical: identity },
  mA: { canonicalUnit: 'A', toCanonical: scale(MILLI) },
  cA: { canonicalUnit: 'A', toCanonical: scale(CENTI) },

  // duration -> s
  s: { canonicalUnit: 's', toCanonical: identity },
  ms: { canonicalUnit: 's', toCanonical: scale(MILLI) },
  us: { canonicalUnit: 's', toCanonical: scale(MICRO) },

  // dimensionless: still declared explicitly, so "no unit" is a decision rather than an omission
  ratio: { canonicalUnit: 'ratio', toCanonical: identity },
  percent: { canonicalUnit: 'percent', toCanonical: identity },
  count: { canonicalUnit: 'count', toCanonical: identity },
  unitless: { canonicalUnit: 'unitless', toCanonical: identity },
} as const satisfies Record<string, ConversionSpec>;

export type KnownSourceUnit = keyof typeof CONVERSIONS;

/** Every source unit the table can convert. Useful for adapter conformance tests. */
export const KNOWN_SOURCE_UNITS: readonly KnownSourceUnit[] = Object.freeze(
  Object.keys(CONVERSIONS) as KnownSourceUnit[],
);

export function isKnownSourceUnit(sourceUnit: SourceUnit): sourceUnit is KnownSourceUnit {
  return Object.hasOwn(CONVERSIONS, sourceUnit);
}

/**
 * Look up the conversion for a source unit.
 *
 * @throws {UnknownUnitError} when the unit is not declared in the table.
 */
export function getUnitConversion(sourceUnit: SourceUnit): UnitConversion {
  if (!isKnownSourceUnit(sourceUnit)) {
    throw new UnknownUnitError(sourceUnit);
  }
  const spec: ConversionSpec = CONVERSIONS[sourceUnit];
  return Object.freeze({
    sourceUnit,
    canonicalUnit: spec.canonicalUnit,
    toCanonical: spec.toCanonical,
  });
}

/**
 * Convert one value from a source unit into its canonical unit.
 *
 * NaN in gives NaN out: an absent measurement stays absent rather than becoming a number. The
 * caller is responsible for pairing the result with the right `Validity` (doc 02 §3 invariants
 * 1a/1b).
 *
 * @throws {UnknownUnitError} when the unit is not declared in the table.
 */
export function convertToCanonical(value: number, sourceUnit: SourceUnit): number {
  if (!isKnownSourceUnit(sourceUnit)) {
    throw new UnknownUnitError(sourceUnit);
  }
  return CONVERSIONS[sourceUnit].toCanonical(value);
}

/** The canonical unit a source unit maps to, without performing a conversion. */
export function canonicalUnitFor(sourceUnit: SourceUnit): CanonicalUnit {
  if (!isKnownSourceUnit(sourceUnit)) {
    throw new UnknownUnitError(sourceUnit);
  }
  return CONVERSIONS[sourceUnit].canonicalUnit;
}
