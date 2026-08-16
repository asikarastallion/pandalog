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
 * Doc 02 §3 invariant 1 states the rule as "validity !== VALID ⇒ value is NaN", so this set is
 * exactly `{VALID}`. It is named rather than inlined because Phase C (resampling) is expected to
 * revisit whether `INTERPOLATED` belongs here — see the open question recorded in
 * 05_IMPLEMENTATION_ROADMAP.md. Changing this set is a contract change, not a refactor.
 */
export const VALUE_BEARING_VALIDITIES: ReadonlySet<Validity> = new Set<Validity>([Validity.VALID]);
