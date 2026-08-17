/**
 * `@pandalog/comparison` — flight-vs-flight and flight-vs-baseline comparison.
 *
 * Layer 9: depends on schema, core-domain, query, events, analysis and verification; platform
 * neutral. It computes nothing about a single flight — every input here was produced by a stage
 * below it, and this package only puts two of them side by side.
 *
 * One rule runs through the whole package, and it is the same shape as the one
 * `@pandalog/verification` is built around: **an axis that was not compared is never reported as
 * showing no difference.** Different time origins, mismatched units, disjoint windows, two
 * different requirement sets — all of them are `INCOMPARABLE`, said out loud, rather than a quiet
 * `SAME` that a reader cannot distinguish from a real result.
 */

export { ComparisonError } from './errors.js';
export type { ComparisonErrorCode } from './errors.js';

export { combineVerdicts } from './verdict.js';
export type { ComparisonVerdict } from './verdict.js';

export {
  DEFAULT_EVENT_TIMING_TOLERANCE,
  DEFAULT_SIGNAL_TOLERANCE,
  validateTolerance,
} from './tolerance.js';
export type { ComparisonTolerance } from './tolerance.js';

export { resolveTimeAlignment } from './time-alignment.js';
export type { TimeAlignment, TimeAlignmentBasis } from './time-alignment.js';

// Only the shapes that appear in a report are exported. `summariseSignal` and friends are how this
// package computes them, not part of what it promises.
export type { SignalStatistics, ValueRange } from './statistics.js';

export { compareSignals } from './signals.js';
export type {
  AlignedDifference,
  ComparisonMethod,
  SignalComparisonOptions,
  SignalDifference,
  SignalsComparison,
} from './signals.js';

export { compareEvents } from './events.js';
export type {
  EventComparisonMethod,
  EventComparisonOptions,
  EventMatch,
  EventsComparison,
  EventTypeCount,
} from './events.js';

export { compareFindings } from './findings.js';
export type {
  FindingChange,
  FindingChangeKind,
  FindingsComparison,
  MeasurementDelta,
} from './findings.js';

export { compareVerification } from './verification.js';
export type { OutcomeChange, OutcomeDirection, VerificationComparison } from './verification.js';

export { compareFlights } from './compare.js';
export type {
  ComparisonInput,
  ComparisonOptions,
  ComparisonReport,
  ComparisonSubject,
} from './compare.js';
