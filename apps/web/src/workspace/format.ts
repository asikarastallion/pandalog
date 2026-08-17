/**
 * Display formatting.
 *
 * The one rule this file exists to respect: it formats, it does not compute (doc 04 §1 rule 1).
 * Every unit conversion is delegated to `@pandalog/core-domain`; there is no arithmetic here beyond
 * choosing decimal places.
 *
 * The other rule is that absent data stays absent. A sample that is not value-bearing carries `NaN`
 * (doc 02 §3 invariant 1b), and it renders as an em dash — never as `0`, never as `NaN` spelled out
 * next to a unit as though it were a reading.
 */
import { DISPLAY_UNIT_OF, toDisplayUnit } from '@pandalog/core-domain';
import { isCanonicalUnit, Validity, type CanonicalUnit } from '@pandalog/schema';
import type { VerificationOutcome } from '@pandalog/verification';

/** What a value renders as when there is genuinely no number. */
export const ABSENT = '—';

const DEFAULT_DECIMALS = 3;

/** A number for display, or `ABSENT` when it is not a number at all. */
export function formatNumber(value: number, decimals = DEFAULT_DECIMALS): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : ABSENT;
}

export interface FormattedValue {
  readonly text: string;
  readonly unit: string;
  /** False when there was no number to show, so a caller can style it as absent. */
  readonly present: boolean;
}

/**
 * A canonical value in the unit a reader expects.
 *
 * The conversion is `core-domain`'s; this decides only how many digits to show.
 */
export function formatCanonical(
  value: number,
  unit: CanonicalUnit,
  decimals = DEFAULT_DECIMALS,
): FormattedValue {
  const displayed = toDisplayUnit(value, unit);
  return {
    text: formatNumber(displayed.value, decimals),
    unit: displayed.unit,
    present: Number.isFinite(displayed.value),
  };
}

/**
 * A value whose unit came from a `Finding` measurement or threshold, where the unit is a plain
 * string rather than a `CanonicalUnit`.
 *
 * A recognised canonical unit is converted for display; anything else is shown exactly as the rule
 * stated it. Guessing at an unrecognised unit is the assumption doc 04 §1 rule 7 forbids.
 */
export function formatQuantity(
  value: number,
  unit: string,
  decimals = DEFAULT_DECIMALS,
): FormattedValue {
  return isCanonicalUnit(unit)
    ? formatCanonical(value, unit, decimals)
    : { text: formatNumber(value, decimals), unit, present: Number.isFinite(value) };
}

/** The unit label a signal's axis carries. */
export const axisUnit = (unit: CanonicalUnit): string => DISPLAY_UNIT_OF(unit);

/** Seconds on the flight time base. */
export function formatSeconds(seconds: number, decimals = 2): string {
  return Number.isFinite(seconds) ? `${seconds.toFixed(decimals)} s` : ABSENT;
}

/** A closed interval, as an engineer would write it. */
export function formatWindow(startSeconds: number, endSeconds: number): string {
  return `t = [${formatNumber(startSeconds, 2)}, ${formatNumber(endSeconds, 2)}] s`;
}

/** Bytes, for provenance display. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return ABSENT;
  }
  const KIB = 1024;
  const MIB = KIB * KIB;
  if (bytes < KIB) {
    return `${String(bytes)} B`;
  }
  return bytes < MIB ? `${(bytes / KIB).toFixed(1)} KiB` : `${(bytes / MIB).toFixed(1)} MiB`;
}

/**
 * Plain-language gloss for a validity.
 *
 * Shown alongside the enum name rather than instead of it: the enum is the contract, but "the
 * sensor did not report" is what tells an engineer whether to worry.
 */
export const VALIDITY_MEANING: Readonly<Record<Validity, string>> = Object.freeze({
  [Validity.VALID]: 'measured',
  [Validity.INTERPOLATED]: 'interpolated between measurements',
  [Validity.MISSING]: 'no data at this time',
  [Validity.INVALID]: 'reported but not usable',
  [Validity.UNSUPPORTED]: 'this vehicle never logged it',
});

/**
 * Plain-language gloss for a verification outcome.
 *
 * `NOT_APPLICABLE` and `INCONCLUSIVE` are spelled out deliberately: the whole point of having four
 * outcomes is that a reader must not collapse them into pass and fail.
 */
export const OUTCOME_MEANING: Readonly<Record<VerificationOutcome, string>> = Object.freeze({
  PASS: 'met the criterion',
  FAIL: 'did not meet the criterion',
  INCONCLUSIVE: 'could not be determined from this flight — not a pass',
  NOT_APPLICABLE: 'does not apply to this flight',
});

/** CSS modifier for an outcome, so styling stays declarative in the component. */
export const outcomeTone = (outcome: VerificationOutcome): string => outcome.toLowerCase();
