/**
 * Hypothesis generation — 03_ANALYSIS_AND_VERIFICATION.md §1.
 *
 * Doc 03 §1's worked example ends with a hypothesis — "Possible actuator saturation contributed" —
 * and then, pointedly, "Root cause: Not established". This module produces statements of exactly
 * that standing.
 *
 * A hypothesis here is proposed on *co-occurrence*, and co-occurrence is not causation. The
 * statements say "may have contributed" because that is all overlapping time windows support. The
 * type system enforces the rest: a Hypothesis has no severity and no verification status, so
 * nothing downstream can promote one into a result.
 */
import { createHypothesis, type Hypothesis } from './hypothesis.js';
import { evidenceTimeSpan } from './evidence.js';
import type { Finding } from './finding.js';

interface Span {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

const overlaps = (a: Span, b: Span): boolean =>
  a.startSeconds <= b.endSeconds && b.startSeconds <= a.endSeconds;

/**
 * Propose explanations for findings that coincide in time.
 *
 * Currently one pattern: a vibration excursion overlapping an attitude tracking exceedance. High
 * vibration corrupting the attitude estimate is a recognised failure path, so the overlap is worth
 * putting in front of an engineer — but which caused which, or whether a third factor drove both,
 * is not established by the overlap, and the statement says so.
 */
export function proposeHypotheses(findings: readonly Finding[]): Hypothesis[] {
  const spans = new Map<string, Span>();
  for (const finding of findings) {
    const span = evidenceTimeSpan(finding.evidence);
    if (span !== null) {
      spans.set(finding.id, span);
    }
  }

  const vibration = findings.filter((finding) => finding.ruleId === 'analysis:vibration-level');
  const tracking = findings.filter(
    (finding) => finding.ruleId === 'analysis:attitude-tracking-error',
  );

  const hypotheses: Hypothesis[] = [];

  for (const vibrationFinding of vibration) {
    const vibrationSpan = spans.get(vibrationFinding.id);
    if (vibrationSpan === undefined) {
      continue;
    }

    for (const trackingFinding of tracking) {
      const trackingSpan = spans.get(trackingFinding.id);
      if (trackingSpan === undefined || !overlaps(vibrationSpan, trackingSpan)) {
        continue;
      }

      hypotheses.push(
        createHypothesis({
          id: `hypothesis:vibration-tracking@${vibrationSpan.startSeconds.toFixed(6)}`,
          relatedFindingIds: [vibrationFinding.id, trackingFinding.id],
          statement:
            'Elevated vibration overlapping the attitude tracking exceedance may have contributed ' +
            'to it, for example by degrading the attitude estimate. This is proposed from ' +
            'co-occurrence in time only: the direction of causation is not established, and a ' +
            'common third cause is not excluded.',
          supportingEvidence: [...vibrationFinding.evidence, ...trackingFinding.evidence],
        }),
      );
    }
  }

  return hypotheses.sort((a, b) => a.id.localeCompare(b.id));
}
