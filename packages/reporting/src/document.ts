/**
 * The report document — doc 04 §7.
 *
 * The shape is the enforcement. Doc 04 §7 says a number in a report that is not traceable to
 * `analysis`/`verification`/`comparison` output is a boundary violation, so the document **embeds
 * those artifacts unchanged** rather than projecting them into a reporting-shaped copy. A copy is
 * where a rounding, a unit conversion or a recomputed average gets in; an embedded artifact cannot
 * disagree with itself.
 *
 * What this package adds on top is deliberately short: provenance, a tally, and an ordering.
 *
 * `generatedAtUtc` sits outside `provenance` on purpose. Phase K's acceptance criterion allows a
 * report's rendered form to differ between runs only in "non-substantive metadata like generation
 * timestamp", which it can only be if it is not part of the record a reader uses to reproduce the
 * run. Provenance answers "what was analysed, by what, at which versions"; the clock answers "when
 * was this printed", and mixing them would make every reprint look like a different analysis.
 */
import type { Finding, Hypothesis, RuleExecution, Severity } from '@pandalog/analysis';
import type { ComparisonReport, ComparisonTolerance } from '@pandalog/comparison';
import type { FlightEvent } from '@pandalog/events';
import type { CanonicalFlightDataset, SourceProvenance, Vehicle } from '@pandalog/schema';
import type {
  RequirementSource,
  VerificationOutcome,
  VerificationReport,
} from '@pandalog/verification';

/** Semver of this package, stamped into every report so a reader knows what rendered it. */
export const REPORTING_VERSION = '0.1.0';

export interface RequirementSetIdentity {
  readonly id: string;
  readonly version: string;
  readonly source: RequirementSource;
}

export interface ReportProvenance {
  /** Verbatim from the dataset: file name, SHA-256, size, format, parser package and version. */
  readonly source: SourceProvenance;
  readonly schemaVersion: string;
  readonly vehicle: Vehicle;
  readonly reportingVersion: string;
  /** Every rule the flight was checked against, with the version it ran at (doc 04 §7). */
  readonly rules: readonly RuleExecution[];
  readonly requirementSet: RequirementSetIdentity;
  /** The thresholds a comparison was judged under, or null when nothing was compared. */
  readonly comparisonTolerances: readonly ComparisonTolerance[] | null;
}

export interface ReportCounts {
  readonly findings: number;
  readonly findingsBySeverity: Readonly<Record<Severity, number>>;
  /** The verification report's own summary, by reference — not recounted here. */
  readonly outcomes: Readonly<Record<VerificationOutcome, number>>;
}

export interface ReportDocument {
  readonly title: string;
  /** When this copy was printed. Deliberately not part of `provenance`. */
  readonly generatedAtUtc: string;
  readonly provenance: ReportProvenance;
  readonly counts: ReportCounts;
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  /**
   * The events the flight produced, embedded unchanged (ADR-0016).
   *
   * A report without them cannot say what mode the aircraft was in when a finding fired, which is
   * among the first things a reader asks of a finding's time window. They are facts, not judgements
   * (doc 03 §1), and nothing here interprets them.
   */
  readonly events: readonly FlightEvent[];
  /**
   * The flight's extent on its own time axis, or null when no signal carries a sample.
   *
   * Selected from the dataset by `datasetTimeSpan`, so the last mode interval can be bounded by
   * where the recording stopped rather than by the last transition — which is not the same instant
   * (ADR-0016).
   */
  readonly timeSpan: { readonly startSeconds: number; readonly endSeconds: number } | null;
  /** Rules that did not apply to this flight — silent, which is not the same as passing. */
  readonly notApplicableRuleIds: readonly string[];
  readonly verification: VerificationReport;
  /** Null for a single-flight report; an empty object would read as a comparison that found none. */
  readonly comparison: ComparisonReport | null;
}

export interface ReportInput {
  readonly dataset: CanonicalFlightDataset;
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  /** Optional so an existing caller keeps working; absent means "none carried", not "none occurred". */
  readonly events?: readonly FlightEvent[];
  readonly notApplicableRuleIds: readonly string[];
  readonly executedRules: readonly RuleExecution[];
  readonly verification: VerificationReport;
  readonly comparison?: ComparisonReport;
  /**
   * Clock for `generatedAtUtc`. Injected rather than read from the environment, because it is the
   * one value that legitimately differs between two runs and doc 03 §6 requires everything else to
   * be identical — a `new Date()` here would make that untestable.
   */
  readonly now: () => Date;
  readonly title?: string;
}
