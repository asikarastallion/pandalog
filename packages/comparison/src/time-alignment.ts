/**
 * Putting two flights on one time axis — doc 04 §1 rule 8.
 *
 * `TimeBase` in doc 02 §2 tells consumers not to "assume ... synchronization across two datasets
 * without checking syncUncertaintySeconds". This package is the first that has two datasets, so it
 * is the first that can break that sentence.
 *
 * There is exactly one basis on which two flights' timelines can be laid over each other, and it is
 * worth being precise about what it does and does not claim:
 *
 *   **Elapsed time since each flight's own origin event.** t = 30 means "30 s after arming" in
 *   both. This needs no shared clock at all, which is why an unstated `syncUncertaintySeconds` does
 *   not block it — that field measures distance from *UTC truth*, and nothing here maps to UTC.
 *   What it does need is for both zeros to mean the same event, which a matching `TimeOrigin` is
 *   exactly the assertion of.
 *
 * Absolute alignment is not offered, and not because it is hard: two flights flown at different
 * times never overlap on an absolute axis, so a comparison there would have nothing in common to
 * compare. `syncUncertaintySeconds` is still reported when both sides state one, because it is what
 * a reader needs in order to decide whether a sub-second difference is a difference or a clock.
 *
 * The limitation elapsed alignment carries, which the report states rather than leaves implicit:
 * two flights at the same elapsed second are not necessarily at the same point in their missions.
 * `BOOT` is especially weak here — power-on to takeoff varies by minutes — while `ARM` is a much
 * more repeatable anchor. The origin is reported so a reader can weigh that themselves.
 */
import type { TimeBase, TimeOrigin } from '@pandalog/schema';

export type TimeAlignmentBasis = 'elapsed-since-origin' | 'none';

export interface TimeAlignment {
  /** Whether anything time-domain may be compared at all. */
  readonly comparable: boolean;
  readonly basis: TimeAlignmentBasis;
  /** The shared origin event, or null when there is not one. */
  readonly origin: TimeOrigin | null;
  /**
   * One-sigma uncertainty, in seconds, of placing the two flights on a common absolute clock.
   * Null when either side leaves it unstated — never 0, which is a positive claim (doc 02 §2).
   */
  readonly syncUncertaintySeconds: number | null;
  readonly reason: string;
}

/** Combine independent one-sigma estimates, as `@pandalog/query`'s `alignSignals` does. */
const combineUncertainty = (a: number, b: number): number => Math.sqrt(a * a + b * b);

/**
 * Decide whether two flights can be laid on one time axis, and say what that would mean.
 *
 * Never throws: an alignment that cannot be made is a reportable state, not an error, and the
 * comparison still has plenty to say without a time axis.
 */
export function resolveTimeAlignment(baseline: TimeBase, subject: TimeBase): TimeAlignment {
  if (baseline.origin !== subject.origin) {
    return Object.freeze({
      comparable: false,
      basis: 'none' as const,
      origin: null,
      syncUncertaintySeconds: null,
      reason:
        `The baseline's timeline is measured from ${baseline.origin} and the subject's from ` +
        `${subject.origin}, so the same t means two different things in the two flights. Comparing ` +
        'them point by point would report a difference that is an artefact of the offset between ' +
        'the two reference events rather than anything the vehicles did (doc 02 §2).',
    });
  }

  const baselineSync = baseline.syncUncertaintySeconds;
  const subjectSync = subject.syncUncertaintySeconds;
  const syncUncertaintySeconds =
    baselineSync === null || subjectSync === null
      ? null
      : combineUncertainty(baselineSync, subjectSync);

  const synchronisation =
    syncUncertaintySeconds === null
      ? 'Neither flight states its offset from UTC, which this comparison does not need but which ' +
        'means a sub-second difference cannot be separated from clock error.'
      : `Placing both on a common absolute clock would carry ${syncUncertaintySeconds.toFixed(6)} s ` +
        'of one-sigma uncertainty.';

  return Object.freeze({
    comparable: true,
    basis: 'elapsed-since-origin' as const,
    origin: baseline.origin,
    syncUncertaintySeconds,
    reason:
      `Both flights measure elapsed time from ${baseline.origin}, so t is the same quantity in ` +
      'each. This is an alignment of elapsed time, not of clocks: two flights at the same elapsed ' +
      'second are not necessarily at the same point in their missions, so a difference at t may be ' +
      `a difference in phase as much as in behaviour. ${synchronisation}`,
  });
}
