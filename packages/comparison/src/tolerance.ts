/**
 * The numbers that decide what counts as a material difference — doc 03 §4.
 *
 * Any threshold that decides an outcome has to say where it came from, and comparison introduces
 * two of them. Reusing `ThresholdBasis` and `isThresholdBasis` from `@pandalog/analysis` rather than
 * restating the vocabulary keeps a comparison tolerance and an analysis threshold held to the same
 * standard — and the defaults below are honestly labelled `provisional`, which doc 03 §4 permits
 * precisely so an unjustified number can ship while saying that it is unjustified.
 *
 * Note what is *not* here. There is no tolerance for findings or for verification outcomes, because
 * neither needs one: a rule that changed its severity, and a requirement that changed its outcome,
 * have already been judged by the package whose job that is. Inventing a second opinion about
 * materiality on top of theirs is how a comparison starts disagreeing with the analysis it reports.
 */
import { isThresholdBasis, type ThresholdBasis } from '@pandalog/analysis';

import { ComparisonError } from './errors.js';

export interface ComparisonTolerance {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly basis: ThresholdBasis;
}

/**
 * How far a signal may move before the difference is called material.
 *
 * Expressed as a fraction of the *baseline signal's own range*, not as an absolute number, because
 * one absolute tolerance cannot serve a roll angle in radians and a battery current in amps. The
 * normalisation also matches the question being asked: a deviation matters relative to how much the
 * signal was moving anyway.
 *
 * A baseline that never moved has zero range, so the tolerance is zero and exact equality is
 * required. That is the correct reading rather than a degenerate one — against a constant, any
 * movement at all is the entire change.
 */
export const DEFAULT_SIGNAL_TOLERANCE: ComparisonTolerance = Object.freeze({
  label: 'signal difference, as a fraction of the baseline signal range',
  value: 0.02,
  unit: 'fraction',
  basis: 'provisional' as const,
});

/**
 * How far an event may shift and still be considered the same event.
 *
 * One second is loose enough to absorb the run-to-run scatter in when a pilot changes mode or a
 * receiver drops a fix, and tight enough that two unrelated occurrences do not get matched to each
 * other. It is a guess, and it says so.
 */
export const DEFAULT_EVENT_TIMING_TOLERANCE: ComparisonTolerance = Object.freeze({
  label: 'event timing',
  value: 1,
  unit: 's',
  basis: 'provisional' as const,
});

/**
 * Check a tolerance can actually decide something.
 *
 * @throws {ComparisonError} INVALID_TOLERANCE when the value is not a finite non-negative number,
 * or when the basis is outside doc 03 §4's vocabulary.
 */
export function validateTolerance(tolerance: ComparisonTolerance): ComparisonTolerance {
  const fail = (message: string): never => {
    throw new ComparisonError('INVALID_TOLERANCE', message, { tolerance });
  };

  if (tolerance.label.trim().length === 0) {
    fail('A comparison tolerance needs a label saying what it bounds.');
  }
  if (!Number.isFinite(tolerance.value)) {
    fail(`Tolerance ${tolerance.label} must be a finite number, got ${String(tolerance.value)}.`);
  }
  if (tolerance.value < 0) {
    fail(
      `Tolerance ${tolerance.label} is negative (${String(tolerance.value)}). A negative bound is ` +
        'satisfied by nothing, so every comparison would report a difference regardless of the data.',
    );
  }
  if (tolerance.unit.trim().length === 0) {
    fail(`Tolerance ${tolerance.label} must state its unit.`);
  }
  if (!isThresholdBasis(tolerance.basis)) {
    fail(
      `Tolerance ${tolerance.label} declares basis ${JSON.stringify(tolerance.basis)}. It must be ` +
        'spec:<document/section>, empirical:<dataset/method>, or provisional (doc 03 §4). A number ' +
        'that decides whether two flights differ may be unjustified, but it must say so.',
    );
  }

  return Object.freeze({ ...tolerance });
}
