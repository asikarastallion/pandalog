/**
 * Comparing two flights' verification outcomes — doc 03 §3.
 *
 * This is the axis a flight-test engineer reads first, and the one where a wrong answer costs the
 * most, so it is built around two refusals.
 *
 * **It will not compare answers to different questions.** If the two reports ran different
 * requirement sets, or different versions of one set, the outcomes are `INCOMPARABLE` — not
 * reconciled by id. Two reports can agree on every requirement id they happen to share and mean
 * nothing by it, because `REQ-ATT-001` in v1 and `REQ-ATT-001` in v2 are the same name for two
 * different criteria. Silently lining them up would produce a green comparison that certifies
 * nothing.
 *
 * **It will not rank applicability against verdict.** `NOT_APPLICABLE` says the question was not
 * asked of this flight; it is not a better or worse answer than `PASS`. Putting it on the same
 * scale would turn "we stopped testing this" into an improvement — the outcome most worth catching,
 * reported as the outcome least worth reading.
 *
 * On the scale that remains: `PASS` > `INCONCLUSIVE` > `FAIL`. `INCONCLUSIVE` sits below `PASS`
 * because a requirement that lost the evidence for its pass has lost assurance, and doc 03 §3's
 * whole point is that the two are not interchangeable.
 */
import type { VerificationOutcome, VerificationReport } from '@pandalog/verification';

import type { ComparisonVerdict } from './verdict.js';

export type OutcomeDirection =
  'UNCHANGED' | 'REGRESSION' | 'IMPROVEMENT' | 'APPLICABILITY_CHANGED' | 'ADDED' | 'REMOVED';

export interface OutcomeChange {
  readonly requirementId: string;
  readonly baseline: VerificationOutcome | null;
  readonly subject: VerificationOutcome | null;
  readonly direction: OutcomeDirection;
}

export interface VerificationComparison {
  readonly verdict: ComparisonVerdict;
  /** Ordered by requirement id (doc 03 §6). Empty when the reports were not comparable. */
  readonly changes: readonly OutcomeChange[];
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  readonly reason: string;
}

/** Assurance ranking. `NOT_APPLICABLE` is absent on purpose — it is not on this scale. */
const ASSURANCE: Readonly<Partial<Record<VerificationOutcome, number>>> = Object.freeze({
  PASS: 2,
  INCONCLUSIVE: 1,
  FAIL: 0,
});

function directionOf(
  baseline: VerificationOutcome | null,
  subject: VerificationOutcome | null,
): OutcomeDirection {
  if (baseline === null) {
    return 'ADDED';
  }
  if (subject === null) {
    return 'REMOVED';
  }
  if (baseline === subject) {
    return 'UNCHANGED';
  }

  const before = ASSURANCE[baseline];
  const after = ASSURANCE[subject];
  if (before === undefined || after === undefined) {
    return 'APPLICABILITY_CHANGED';
  }

  return after < before ? 'REGRESSION' : 'IMPROVEMENT';
}

const incomparable = (reason: string): VerificationComparison =>
  Object.freeze({
    verdict: 'INCOMPARABLE' as const,
    changes: Object.freeze([]),
    regressions: Object.freeze([]),
    improvements: Object.freeze([]),
    reason,
  });

/** Compare two verification reports, requirement by requirement. */
export function compareVerification(
  baseline: VerificationReport,
  subject: VerificationReport,
): VerificationComparison {
  if (baseline.requirementSetId !== subject.requirementSetId) {
    return incomparable(
      `The baseline was verified against requirement set ${JSON.stringify(baseline.requirementSetId)} ` +
        `and the subject against ${JSON.stringify(subject.requirementSetId)}. Those are answers to ` +
        'different questions, and matching them by requirement id would report agreement between ' +
        'criteria that were never the same criteria.',
    );
  }

  if (baseline.requirementSetVersion !== subject.requirementSetVersion) {
    return incomparable(
      `Both flights were verified against requirement set ${JSON.stringify(baseline.requirementSetId)}, ` +
        `but at versions ${baseline.requirementSetVersion} and ${subject.requirementSetVersion}. A ` +
        'version bump is how a requirement records that its logic changed (doc 03 §2), so the same ' +
        'id no longer names the same criterion.',
    );
  }

  const baselineOutcomes = new Map(
    baseline.results.map((result) => [result.requirementId, result.outcome]),
  );
  const subjectOutcomes = new Map(
    subject.results.map((result) => [result.requirementId, result.outcome]),
  );

  const requirementIds = [
    ...new Set([...baselineOutcomes.keys(), ...subjectOutcomes.keys()]),
  ].sort();

  const changes = requirementIds.map((requirementId) => {
    const before = baselineOutcomes.get(requirementId) ?? null;
    const after = subjectOutcomes.get(requirementId) ?? null;
    return Object.freeze({
      requirementId,
      baseline: before,
      subject: after,
      direction: directionOf(before, after),
    });
  });

  const idsWhere = (direction: OutcomeDirection): string[] =>
    changes
      .filter((change) => change.direction === direction)
      .map((change) => change.requirementId);

  const regressions = idsWhere('REGRESSION');
  const improvements = idsWhere('IMPROVEMENT');
  const changed = changes.filter((change) => change.direction !== 'UNCHANGED');

  return Object.freeze({
    verdict: changed.length > 0 ? ('DIFFERENT' as const) : ('SAME' as const),
    changes: Object.freeze(changes),
    regressions: Object.freeze(regressions),
    improvements: Object.freeze(improvements),
    reason:
      `${String(changes.length)} requirement(s) compared against set ` +
      `${baseline.requirementSetId}@${baseline.requirementSetVersion}: ` +
      `${String(regressions.length)} regressed, ${String(improvements.length)} improved, ` +
      `${String(idsWhere('APPLICABILITY_CHANGED').length)} changed applicability, ` +
      `${String(idsWhere('ADDED').length)} added, ${String(idsWhere('REMOVED').length)} removed.`,
  });
}
