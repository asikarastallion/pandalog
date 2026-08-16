/**
 * Validity — 02_CANONICAL_DATA_MODEL.md §2.
 *
 * Validity is a first-class value, never inferred from the number. A sample's numeric value and
 * its Validity are stored together and both must be read.
 */
export enum Validity {
  VALID = 'VALID',
  MISSING = 'MISSING', // no sample was logged for this instant
  INVALID = 'INVALID', // sample present but fails a declared range/sanity check
  UNSUPPORTED = 'UNSUPPORTED', // source format/firmware does not provide this signal
  INTERPOLATED = 'INTERPOLATED', // derived by resampling/interpolation, not an original sample
}

const VALIDITY_SET: ReadonlySet<string> = new Set<string>(Object.values(Validity));

export function isValidity(value: unknown): value is Validity {
  return typeof value === 'string' && VALIDITY_SET.has(value);
}

/**
 * The validity states whose paired numeric value must be finite. Every other state requires NaN.
 *
 * This is the single expression of doc 02 §3 invariants 1a and 1b (ADR-0007):
 *
 *   value-bearing      VALID, INTERPOLATED              -> value MUST be finite
 *   non-value-bearing  MISSING, INVALID, UNSUPPORTED    -> value MUST be NaN
 *
 * `INTERPOLATED` belongs here because it means "a number produced by resampling"; it carries a
 * usable value by definition. `NaN` is reserved for the cases where it is true and informative:
 * there is genuinely no number here.
 *
 * Consumers must not treat `validity === VALID` as "has a usable number" — test membership in this
 * set instead. A rule that specifically requires a *measured* value should say so explicitly.
 *
 * Changing this set is a contract change requiring an ADR, not a refactor.
 */
export const VALUE_BEARING_VALIDITIES: ReadonlySet<Validity> = new Set<Validity>([
  Validity.VALID,
  Validity.INTERPOLATED,
]);

/** True when `validity` requires a finite paired value (doc 02 §3 invariant 1a). */
export function isValueBearing(validity: Validity): boolean {
  return VALUE_BEARING_VALIDITIES.has(validity);
}
