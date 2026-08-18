/**
 * Grouping repeated findings — presentation, not analysis.
 *
 * A rule that fires on every excursion produces one Finding per excursion, and that is correct:
 * doc 03 §2 makes a Finding a single evidence-backed claim, so twenty-four pitch excursions are
 * twenty-four claims and collapsing them upstream would destroy the evidence chain. What it also
 * produces is a report in which one sentence appears twenty-four times with the numbers changed,
 * which is a data dump wearing a report's clothes.
 *
 * So the grouping happens **here**, at the point of render, and it is additive: `findings` on every
 * group carries every original Finding, in order, unaltered. Nothing is dropped, merged or
 * rewritten. Remove this module and the artifacts are exactly what they were.
 *
 * ## What a group may state, and what it may not
 *
 * Doc 04 §7: a number in a report that is not traceable to `analysis`/`verification`/`comparison`
 * output is a boundary violation. That admits two operations and rules out a third:
 *
 *   - **Tally** — `count` is the length of the list being rendered. Counting the things you are
 *     printing is rendering.
 *   - **Selection** — `peak`, `firstSeconds`, `lastSeconds` are *one of the findings' own numbers*,
 *     chosen. The value printed is a value an evidence-backed Finding already asserted, and
 *     `peakFindingId` names which one so a reader can go and check it.
 *   - **Arithmetic — no.** A total exceedance duration ("87.3 s across 24 excursions") is a new
 *     quantity that no Finding asserts and no evidence supports. It is the single most tempting
 *     number to put in a rollup and it is not this package's to produce. If total exceedance is
 *     analytically meaningful then it is an analysis result, and it belongs in a rule in
 *     `@pandalog/analysis` that can carry evidence for it — where `no-calculation.test.ts` will
 *     then find it in the corpus and pass it.
 *
 * `rollup.test.ts` holds this line with an invented-total control, the same way
 * `no-calculation.test.ts` holds it for the renderer as a whole.
 */
import { evidenceTimeSpan, type Finding, type Severity } from '@pandalog/analysis';

/**
 * Severity order, worst first. Used only to sort — never to combine two severities into a third,
 * which would be inventing a claim no rule made.
 */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  CRITICAL: 0,
  WARNING: 1,
  ADVISORY: 2,
  INFO: 3,
});

/**
 * The largest value the group recorded under one measurement label.
 *
 * Selected, not computed: `value` is identically one of the group's findings' own measurements.
 */
export interface GroupPeak {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  /** The Finding this value was taken from, so the peak stays traceable to one evidenced claim. */
  readonly findingId: string;
}

export interface FindingGroup {
  /** Stable identity for the group, derived from what defines it. Not a measurement. */
  readonly key: string;
  readonly ruleId: string;
  readonly severity: Severity;
  /**
   * The signals this group's evidence names, sorted.
   *
   * Part of the key because one rule covers several signals: `analysis:attitude-tracking-error`
   * fires on roll and on pitch, and folding those together would produce a group whose statement is
   * true of neither axis on its own.
   */
  readonly signalIds: readonly string[];
  /** Every finding in the group, in the order the analysis produced them. Nothing is dropped. */
  readonly findings: readonly Finding[];
  /** A tally of the list above. */
  readonly count: number;
  /** Earliest and latest instant the group's evidence points at, or null when none is time-bounded. */
  readonly firstSeconds: number | null;
  readonly lastSeconds: number | null;
  /** Per measurement label, the largest value any finding in the group asserted. */
  readonly peaks: readonly GroupPeak[];
}

/** Signal ids an evidence reference names. Event references name none. */
function signalIdsOf(finding: Finding): string[] {
  const ids = new Set<string>();
  for (const reference of finding.evidence) {
    if (reference.kind === 'signal-window' || reference.kind === 'measurement') {
      ids.add(reference.signalId);
    }
  }
  return [...ids].sort();
}

/**
 * What makes two findings the same kind of finding.
 *
 * Rule, severity and the signals involved. Deliberately *not* the statement text: two excursions
 * differ in their statements only by the numbers in them, so keying on the statement would put
 * every finding in a group of one and achieve nothing.
 */
const keyOf = (finding: Finding, signalIds: readonly string[]): string =>
  `${finding.ruleId}|${finding.severity}|${signalIds.join(',')}`;

function peaksOf(findings: readonly Finding[]): GroupPeak[] {
  const best = new Map<string, GroupPeak>();

  for (const finding of findings) {
    for (const measurement of finding.measurements) {
      // A label is only comparable against itself and within one unit. Two findings recording
      // "Peak error" in different units are not two samples of one quantity, and picking the larger
      // number across them would compare a value in rad against a value in deg.
      const slot = `${measurement.label}|${measurement.unit}`;
      const current = best.get(slot);
      if (current === undefined || measurement.value > current.value) {
        best.set(slot, {
          label: measurement.label,
          value: measurement.value,
          unit: measurement.unit,
          findingId: finding.id,
        });
      }
    }
  }

  return [...best.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Group findings for display.
 *
 * Deterministic: the same findings in the same order always produce the same groups in the same
 * order, which is what lets a grouped report stay byte-reproducible (doc 04 §7).
 *
 * Groups are ordered by severity (worst first), then by count (most repeated first), then by key —
 * an engineer scanning a report reads the worst thing first, and the tie-breaks make the order
 * total rather than dependent on input order.
 */
export function groupFindings(findings: readonly Finding[]): readonly FindingGroup[] {
  const buckets = new Map<string, { signalIds: string[]; findings: Finding[] }>();

  for (const finding of findings) {
    const signalIds = signalIdsOf(finding);
    const key = keyOf(finding, signalIds);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { signalIds, findings: [finding] });
    } else {
      bucket.findings.push(finding);
    }
  }

  const groups: FindingGroup[] = [];

  for (const [key, bucket] of buckets) {
    const first = bucket.findings[0];
    if (first === undefined) {
      continue;
    }

    let start: number | null = null;
    let end: number | null = null;
    for (const finding of bucket.findings) {
      const span = evidenceTimeSpan(finding.evidence);
      if (span === null) {
        continue;
      }
      start = start === null ? span.startSeconds : Math.min(start, span.startSeconds);
      end = end === null ? span.endSeconds : Math.max(end, span.endSeconds);
    }

    groups.push(
      Object.freeze({
        key,
        ruleId: first.ruleId,
        severity: first.severity,
        signalIds: Object.freeze([...bucket.signalIds]),
        findings: Object.freeze([...bucket.findings]),
        count: bucket.findings.length,
        firstSeconds: start,
        lastSeconds: end,
        peaks: Object.freeze(peaksOf(bucket.findings)),
      }),
    );
  }

  groups.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byCount = b.count - a.count;
    if (byCount !== 0) {
      return byCount;
    }
    return a.key.localeCompare(b.key);
  });

  return Object.freeze(groups);
}

/** True when grouping actually collapsed something, so a caller can skip a summary of nothing. */
export const isRepeated = (group: FindingGroup): boolean => group.count > 1;
