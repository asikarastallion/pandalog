/**
 * Comparing two flights' event timelines.
 *
 * An event is a fact about what happened and when (doc 03 §2), so comparing timelines means
 * deciding which event in one flight *is* which event in the other. Two constraints keep that from
 * becoming invention:
 *
 *   1. **Type is never crossed.** A mode change and a fix loss at the same instant are two
 *      different facts, and matching them because they are adjacent would have the report claim a
 *      correspondence that does not exist.
 *   2. **Every event matches at most once.** Otherwise one event in the baseline could absorb
 *      several in the subject and an extra occurrence would vanish from the report.
 *
 * Without a shared time axis the timeline cannot be matched at all — but the *counts* still can, and
 * a flight that logged three fix losses where the baseline logged none is worth saying even when
 * nobody can say exactly when. That comparison is labelled `count-only` so its weaker claim is
 * visible in the report rather than inferred from context.
 */
import type { FlightEvent } from '@pandalog/events';

import { groupSorted } from './group.js';
import type { TimeAlignment } from './time-alignment.js';
import {
  DEFAULT_EVENT_TIMING_TOLERANCE,
  validateTolerance,
  type ComparisonTolerance,
} from './tolerance.js';
import type { ComparisonVerdict } from './verdict.js';

export type EventComparisonMethod = 'time-matched' | 'count-only';

export interface EventMatch {
  readonly type: string;
  readonly baselineEventId: string;
  readonly subjectEventId: string;
  /** Subject start minus baseline start, in seconds. Positive means the subject was later. */
  readonly deltaSeconds: number;
}

export interface EventTypeCount {
  readonly type: string;
  readonly baseline: number;
  readonly subject: number;
}

export interface EventsComparison {
  readonly verdict: ComparisonVerdict;
  readonly method: EventComparisonMethod;
  readonly alignment: TimeAlignment;
  readonly matched: readonly EventMatch[];
  readonly onlyInBaseline: readonly string[];
  readonly onlyInSubject: readonly string[];
  /** One row per type seen in either flight, ordered by type. */
  readonly countsByType: readonly EventTypeCount[];
  readonly reason: string;
}

export interface EventComparisonOptions {
  readonly eventTimingTolerance?: ComparisonTolerance;
}

/** Group by type, each group in start-time order so matching does not depend on arrival order. */
const byType = (events: readonly FlightEvent[]): Map<string, FlightEvent[]> =>
  groupSorted(
    events,
    (event) => event.type,
    (a, b) => a.t_start_seconds - b.t_start_seconds || a.id.localeCompare(b.id),
  );

function countsFor(
  baseline: Map<string, FlightEvent[]>,
  subject: Map<string, FlightEvent[]>,
): EventTypeCount[] {
  return [...new Set([...baseline.keys(), ...subject.keys()])].sort().map((type) =>
    Object.freeze({
      type,
      baseline: baseline.get(type)?.length ?? 0,
      subject: subject.get(type)?.length ?? 0,
    }),
  );
}

interface MatchOutcome {
  readonly matched: EventMatch[];
  readonly onlyInBaseline: string[];
  readonly onlyInSubject: string[];
}

/**
 * Nearest-first matching within one type.
 *
 * Baseline events are taken in start order and each claims the closest unclaimed subject event
 * inside the tolerance; ties go to the earlier one. Deterministic, and it does the obviously right
 * thing on the case that matters — a timeline where everything shifted slightly.
 */
function matchWithinType(
  baseline: readonly FlightEvent[],
  subject: readonly FlightEvent[],
  type: string,
  toleranceSeconds: number,
): MatchOutcome {
  const matched: EventMatch[] = [];
  const claimed = new Set<number>();
  const onlyInBaseline: string[] = [];

  for (const event of baseline) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [index, candidate] of subject.entries()) {
      if (claimed.has(index)) {
        continue;
      }
      const distance = Math.abs(candidate.t_start_seconds - event.t_start_seconds);
      if (distance <= toleranceSeconds && distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    const best = bestIndex === -1 ? undefined : subject[bestIndex];
    if (best === undefined) {
      onlyInBaseline.push(event.id);
      continue;
    }

    claimed.add(bestIndex);
    matched.push(
      Object.freeze({
        type,
        baselineEventId: event.id,
        subjectEventId: best.id,
        deltaSeconds: best.t_start_seconds - event.t_start_seconds,
      }),
    );
  }

  const onlyInSubject = subject
    .filter((_unused, index) => !claimed.has(index))
    .map((event) => event.id);

  return { matched, onlyInBaseline, onlyInSubject };
}

/** Compare two event timelines, matching by type and proximity where a time axis allows it. */
export function compareEvents(
  baselineEvents: readonly FlightEvent[],
  subjectEvents: readonly FlightEvent[],
  alignment: TimeAlignment,
  options: EventComparisonOptions = {},
): EventsComparison {
  const tolerance = validateTolerance(
    options.eventTimingTolerance ?? DEFAULT_EVENT_TIMING_TOLERANCE,
  );

  const baseline = byType(baselineEvents);
  const subject = byType(subjectEvents);
  const countsByType = countsFor(baseline, subject);

  if (!alignment.comparable) {
    const countsDiffer = countsByType.some((entry) => entry.baseline !== entry.subject);
    return Object.freeze({
      verdict: countsDiffer ? ('DIFFERENT' as const) : ('SAME' as const),
      method: 'count-only' as const,
      alignment,
      matched: Object.freeze([]),
      onlyInBaseline: Object.freeze([]),
      onlyInSubject: Object.freeze([]),
      countsByType: Object.freeze(countsByType),
      reason:
        'The flights share no time axis, so events were compared by count per type and not by ' +
        `when they happened. ${alignment.reason}`,
    });
  }

  const matched: EventMatch[] = [];
  const onlyInBaseline: string[] = [];
  const onlyInSubject: string[] = [];

  for (const { type } of countsByType) {
    const outcome = matchWithinType(
      baseline.get(type) ?? [],
      subject.get(type) ?? [],
      type,
      tolerance.value,
    );
    matched.push(...outcome.matched);
    onlyInBaseline.push(...outcome.onlyInBaseline);
    onlyInSubject.push(...outcome.onlyInSubject);
  }

  const unmatched = onlyInBaseline.length + onlyInSubject.length;

  return Object.freeze({
    verdict: unmatched > 0 ? ('DIFFERENT' as const) : ('SAME' as const),
    method: 'time-matched' as const,
    alignment,
    matched: Object.freeze(matched),
    onlyInBaseline: Object.freeze(onlyInBaseline.sort()),
    onlyInSubject: Object.freeze(onlyInSubject.sort()),
    countsByType: Object.freeze(countsByType),
    reason:
      `${String(matched.length)} event(s) matched within ${String(tolerance.value)} s, ` +
      `${String(onlyInBaseline.length)} only in the baseline and ${String(onlyInSubject.length)} ` +
      'only in the subject.',
  });
}
