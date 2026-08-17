/**
 * Comparing two flights' findings — doc 03 §2, §4.
 *
 * Findings are matched by the rule that produced them, because a rule is a question asked of both
 * flights and the comparison is of the two answers. Within a rule, repeated findings are matched in
 * time order, so a rule that fired twice in each flight is compared occurrence by occurrence rather
 * than as a pair of unordered heaps.
 *
 * What counts as a material difference here is deliberately narrow: **presence and severity, and
 * nothing else.** A measurement that moved without moving the severity is reported — an engineer
 * chasing a trend needs the number — but it does not by itself make the flights different. The
 * reason is doc 03 §4: severity is the rule's own judgement, backed by a threshold that declares
 * where it came from. A tolerance invented in this package would be a second, unjustified opinion
 * about materiality, and when the two disagreed the comparison would be contradicting the analysis
 * it is supposed to be reporting.
 */
import { evidenceTimeSpan, type Finding, type Severity } from '@pandalog/analysis';

import { ComparisonError } from './errors.js';
import { groupSorted } from './group.js';
import type { ComparisonVerdict } from './verdict.js';

export type FindingChangeKind = 'UNCHANGED' | 'NEW' | 'RESOLVED' | 'SEVERITY_CHANGED';

export interface MeasurementDelta {
  readonly label: string;
  readonly unit: string;
  readonly baseline: number;
  readonly subject: number;
  /** Subject minus baseline, in the shared unit. */
  readonly delta: number;
}

export interface FindingChange {
  readonly ruleId: string;
  readonly kind: FindingChangeKind;
  readonly baselineFindingId: string | null;
  readonly subjectFindingId: string | null;
  readonly baselineSeverity: Severity | null;
  readonly subjectSeverity: Severity | null;
  /** Only measurements both findings reported under the same label and unit. */
  readonly measurementDeltas: readonly MeasurementDelta[];
}

export interface FindingsComparison {
  readonly verdict: ComparisonVerdict;
  /** Ordered by rule id, then by occurrence (doc 03 §6). */
  readonly changes: readonly FindingChange[];
  readonly reason: string;
}

/** When a finding is about, taken from its evidence — the only time a Finding carries. */
const startOf = (finding: Finding): number =>
  evidenceTimeSpan(finding.evidence)?.startSeconds ?? Number.POSITIVE_INFINITY;

const byRule = (findings: readonly Finding[]): Map<string, Finding[]> =>
  groupSorted(
    findings,
    (finding) => finding.ruleId,
    (a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id),
  );

/**
 * Deltas for measurements both findings report under one label.
 *
 * A label present on only one side is left out rather than differenced against zero, and a label
 * whose unit changed is left out too — subtracting metres from feet produces a number that looks
 * like a measurement and is not one (doc 04 §1 rules 6 and 7).
 */
function measurementDeltas(baseline: Finding, subject: Finding): MeasurementDelta[] {
  const subjectByLabel = new Map(subject.measurements.map((entry) => [entry.label, entry]));

  const deltas: MeasurementDelta[] = [];
  for (const measurement of baseline.measurements) {
    const counterpart = subjectByLabel.get(measurement.label);
    if (counterpart?.unit !== measurement.unit) {
      continue;
    }
    deltas.push(
      Object.freeze({
        label: measurement.label,
        unit: measurement.unit,
        baseline: measurement.value,
        subject: counterpart.value,
        delta: counterpart.value - measurement.value,
      }),
    );
  }

  return deltas.sort((a, b) => a.label.localeCompare(b.label));
}

function changeFor(
  ruleId: string,
  baseline: Finding | undefined,
  subject: Finding | undefined,
): FindingChange {
  if (baseline === undefined && subject === undefined) {
    // A rule id only reaches here because at least one side produced a finding for it, and the
    // occurrence index is bounded by the longer of the two groups. Raised rather than defaulted
    // because the only way to continue would be to emit a change describing neither flight.
    throw new ComparisonError(
      'INVALID_SUBJECT',
      `compareFindings reached an occurrence of ${ruleId} that neither flight produced.`,
      { ruleId },
    );
  }

  const base = {
    ruleId,
    baselineFindingId: baseline?.id ?? null,
    subjectFindingId: subject?.id ?? null,
    baselineSeverity: baseline?.severity ?? null,
    subjectSeverity: subject?.severity ?? null,
  };

  if (baseline === undefined || subject === undefined) {
    return Object.freeze({
      ...base,
      kind: baseline === undefined ? ('NEW' as const) : ('RESOLVED' as const),
      measurementDeltas: Object.freeze([]),
    });
  }

  return Object.freeze({
    ...base,
    kind:
      baseline.severity === subject.severity
        ? ('UNCHANGED' as const)
        : ('SEVERITY_CHANGED' as const),
    measurementDeltas: Object.freeze(measurementDeltas(baseline, subject)),
  });
}

/** Compare the findings two flights produced, rule by rule. */
export function compareFindings(
  baselineFindings: readonly Finding[],
  subjectFindings: readonly Finding[],
): FindingsComparison {
  const baseline = byRule(baselineFindings);
  const subject = byRule(subjectFindings);
  const ruleIds = [...new Set([...baseline.keys(), ...subject.keys()])].sort();

  const changes: FindingChange[] = [];
  for (const ruleId of ruleIds) {
    const baselineGroup = baseline.get(ruleId) ?? [];
    const subjectGroup = subject.get(ruleId) ?? [];
    const occurrences = Math.max(baselineGroup.length, subjectGroup.length);

    for (let index = 0; index < occurrences; index += 1) {
      changes.push(changeFor(ruleId, baselineGroup[index], subjectGroup[index]));
    }
  }

  const material = changes.filter((change) => change.kind !== 'UNCHANGED');

  return Object.freeze({
    // Two flights that both produced nothing agree, and that is a real comparison rather than an
    // absent one: "no rule fired" is an answer both sides gave, unlike a signal neither logged.
    verdict: material.length > 0 ? ('DIFFERENT' as const) : ('SAME' as const),
    changes: Object.freeze(changes),
    reason:
      `${String(changes.length)} rule occurrence(s) compared: ` +
      `${String(changes.filter((change) => change.kind === 'NEW').length)} new, ` +
      `${String(changes.filter((change) => change.kind === 'RESOLVED').length)} resolved, ` +
      `${String(changes.filter((change) => change.kind === 'SEVERITY_CHANGED').length)} changed ` +
      'severity. A measurement that moved without changing severity is reported but is not, by ' +
      "itself, a material difference — severity is the rule's own judgement (doc 03 §4).",
  });
}
