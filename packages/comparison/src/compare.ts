/**
 * The comparison report — 05_IMPLEMENTATION_ROADMAP.md Phase J, doc 01 §1.
 *
 * Four axes, each answered separately and each carrying its own verdict, its own reason and — where
 * it applies — the tolerance it judged materiality against. They are kept apart because they fail
 * apart: two flights can share a time axis but not a requirement set, or agree on every signal
 * while one of them raised a finding the other did not. A single boolean over all four would be
 * unable to say which.
 *
 * The overall verdict is deliberately conservative. `DIFFERENT` if any axis established a
 * difference; otherwise `INCOMPARABLE` if any axis could not be checked; `SAME` only when every
 * axis was compared and none differed. So "no material difference" is never something a reader has
 * to interpret — it means all four questions were asked and all four came back clean.
 */
import type { Finding } from '@pandalog/analysis';
import type { FlightEvent } from '@pandalog/events';
import type { CanonicalFlightDataset } from '@pandalog/schema';
import type { VerificationReport } from '@pandalog/verification';

import { compareEvents, type EventsComparison } from './events.js';
import { compareFindings, type FindingsComparison } from './findings.js';
import { compareSignals, type SignalsComparison } from './signals.js';
import { resolveTimeAlignment, type TimeAlignment } from './time-alignment.js';
import {
  DEFAULT_EVENT_TIMING_TOLERANCE,
  DEFAULT_SIGNAL_TOLERANCE,
  validateTolerance,
  type ComparisonTolerance,
} from './tolerance.js';
import { compareVerification, type VerificationComparison } from './verification.js';
import { combineVerdicts, type ComparisonVerdict } from './verdict.js';

/**
 * One side of a comparison.
 *
 * Structurally this is a `PipelineResult` plus a label, and that is intentional — but it is
 * declared here rather than imported, because `@pandalog/pipeline` sits above this package in the
 * graph (doc 01 §3) and depending on it would invert the dependency direction. Anything that can
 * produce these four artifacts can be compared, including a stored baseline that was never re-run.
 */
export interface ComparisonSubject {
  /** How this flight is named in the report — a file name, a sortie number, "baseline". */
  readonly label: string;
  readonly dataset: CanonicalFlightDataset;
  readonly events: readonly FlightEvent[];
  readonly findings: readonly Finding[];
  readonly verification: VerificationReport;
}

export interface ComparisonOptions {
  readonly signalTolerance?: ComparisonTolerance;
  readonly eventTimingTolerance?: ComparisonTolerance;
}

export interface ComparisonInput {
  readonly baseline: ComparisonSubject;
  readonly subject: ComparisonSubject;
  /**
   * Clock for `comparedAtUtc`. Injected rather than read from the environment so two runs over the
   * same inputs produce identical reports (doc 03 §6), exactly as the pipeline does.
   */
  readonly now: () => Date;
  readonly options?: ComparisonOptions;
}

export interface ComparisonReport {
  readonly baselineLabel: string;
  readonly subjectLabel: string;
  readonly comparedAtUtc: string;
  readonly alignment: TimeAlignment;
  readonly signals: SignalsComparison;
  readonly events: EventsComparison;
  readonly findings: FindingsComparison;
  readonly verification: VerificationComparison;
  readonly verdict: ComparisonVerdict;
  /** Every threshold that decided a verdict here, with its basis (doc 03 §4). */
  readonly tolerances: readonly ComparisonTolerance[];
}

/**
 * Compare two flights on all four axes.
 *
 * @throws {ComparisonError} INVALID_TOLERANCE when a supplied tolerance is negative, non-finite, or
 * does not declare where it came from. Everything else a comparison can run into — mismatched
 * units, disjoint windows, different requirement sets — is a reportable `INCOMPARABLE` rather than
 * a thrown error, because a partial comparison is still worth reading.
 */
export function compareFlights(input: ComparisonInput): ComparisonReport {
  const signalTolerance = validateTolerance(
    input.options?.signalTolerance ?? DEFAULT_SIGNAL_TOLERANCE,
  );
  const eventTimingTolerance = validateTolerance(
    input.options?.eventTimingTolerance ?? DEFAULT_EVENT_TIMING_TOLERANCE,
  );

  const alignment = resolveTimeAlignment(
    input.baseline.dataset.timeBase,
    input.subject.dataset.timeBase,
  );

  const signals = compareSignals(input.baseline.dataset, input.subject.dataset, alignment, {
    signalTolerance,
  });
  const events = compareEvents(input.baseline.events, input.subject.events, alignment, {
    eventTimingTolerance,
  });
  const findings = compareFindings(input.baseline.findings, input.subject.findings);
  const verification = compareVerification(input.baseline.verification, input.subject.verification);

  return Object.freeze({
    baselineLabel: input.baseline.label,
    subjectLabel: input.subject.label,
    comparedAtUtc: input.now().toISOString(),
    alignment,
    signals,
    events,
    findings,
    verification,
    verdict: combineVerdicts([
      signals.verdict,
      events.verdict,
      findings.verdict,
      verification.verdict,
    ]),
    tolerances: Object.freeze([signalTolerance, eventTimingTolerance]),
  });
}
