/**
 * Mode intervals — the periods between the mode changes a log recorded.
 *
 * A `MODE` record is an instant: "at t = 1.5 s the mode became 5". Every consumer that wants to
 * colour a ground track, band a chart or print a mode log needs the *interval* instead, and three
 * consumers deriving it separately would be three chances to disagree about where a mode ended. So
 * it is derived once, here, in the package that owns events (ADR-0016).
 *
 * ## The boundaries the log does not contain
 *
 * This module has the problem `ARM_DISARM_DETECTOR` in `detectors/source-log.ts` refuses to solve,
 * and it solves it the same way — by naming it rather than filling it in. That detector's note:
 *
 * > a log can begin or end mid-flight: pairing them into an interval would require inventing a
 * > boundary the log does not contain.
 *
 * Mode intervals hit that at both ends:
 *
 *   - **Before the first `MODE` record** the aircraft was in some mode, and the log does not say
 *     which. That period gets a segment with `mode: null` — not the first record's mode carried
 *     backwards, which would colour a stretch of flight with a mode nothing asserted for it.
 *   - **After the last `MODE` record** the mode continued until the data stopped. The end of that
 *     segment is the end of the data, which is not a logged transition.
 *
 * `startsAtLoggedChange` and `endsAtLoggedChange` say which boundaries are real, so a renderer can
 * draw an inferred edge differently from a recorded one instead of presenting both as fact.
 *
 * ## Why the mode is a number
 *
 * ArduPilot writes `Mode` as an integer, and the integer means different things on different
 * airframes: 5 is LOITER on ArduCopter and FBWA on ArduPlane. Resolving it needs the vehicle type,
 * which `Vehicle.frameClass` carries only when the log recorded it — often it is null. So this
 * module reports the number, and naming is a separate, explicitly vehicle-aware step (ADR-0016).
 */
import type { FlightEvent } from './event.js';

/** The event type `MODE_CHANGE_DETECTOR` emits. */
export const MODE_CHANGE_EVENT_TYPE = 'mode-change';

export interface ModeSegment {
  /**
   * The mode number the log recorded, or null for a period the log never stated a mode for.
   *
   * Null is not "unknown mode 0" — it is the absence of a record, kept distinct for the same reason
   * `Validity` keeps a missing sample distinct from a zero one (doc 04 §1 rule 6).
   */
  readonly mode: number | null;
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** False for the period before the first `MODE` record: its start is where the data starts. */
  readonly startsAtLoggedChange: boolean;
  /** False for the last segment: its end is where the data ends, not a recorded transition. */
  readonly endsAtLoggedChange: boolean;
  /** The event this segment began at, for a consumer that wants to cite it. Null when inferred. */
  readonly startEventId: string | null;
}

export interface ModeSegmentWindow {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** `Mode` from a mode-change payload, or null when the record did not carry a usable one. */
function modeNumber(event: FlightEvent): number | null {
  const raw = event.payload.Mode;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Turn the mode-change events of a flight into the intervals each mode was active over.
 *
 * `window` is the extent of the data — normally the flight's own time span. Segments are clipped to
 * it, and a mode change outside it is dropped rather than stretching the timeline to reach it.
 *
 * Returns an empty list for an empty window: there is no interval to describe.
 */
export function modeSegments(
  events: readonly FlightEvent[],
  window: ModeSegmentWindow,
): readonly ModeSegment[] {
  if (!(window.endSeconds > window.startSeconds)) {
    return Object.freeze([]);
  }

  const changes = events
    .filter(
      (event) =>
        event.type === MODE_CHANGE_EVENT_TYPE &&
        event.t_start_seconds >= window.startSeconds &&
        event.t_start_seconds < window.endSeconds,
    )
    .slice()
    .sort((a, b) => a.t_start_seconds - b.t_start_seconds || a.id.localeCompare(b.id));

  if (changes.length === 0) {
    // No mode was ever recorded. That is one segment of unknown mode over the whole window, which
    // is a true statement; returning nothing would let a caller draw an uncoloured track and read
    // it as "no mode changes" rather than "no mode information".
    return Object.freeze([
      Object.freeze({
        mode: null,
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        startsAtLoggedChange: false,
        endsAtLoggedChange: false,
        startEventId: null,
      }),
    ]);
  }

  const segments: ModeSegment[] = [];
  const first = changes[0];

  // The flight before the first recorded change. Kept only if it has extent — a log whose first
  // record is at its own start has no such period, and a zero-width segment is not a period.
  if (first !== undefined && first.t_start_seconds > window.startSeconds) {
    segments.push(
      Object.freeze({
        mode: null,
        startSeconds: window.startSeconds,
        endSeconds: first.t_start_seconds,
        startsAtLoggedChange: false,
        endsAtLoggedChange: true,
        startEventId: null,
      }),
    );
  }

  for (const [index, change] of changes.entries()) {
    const next = changes[index + 1];
    const endSeconds = next?.t_start_seconds ?? window.endSeconds;
    if (!(endSeconds > change.t_start_seconds)) {
      // Two changes at the same instant: the earlier one was never in effect for any duration, so
      // it describes no interval. The transition itself is still in the event list.
      continue;
    }
    segments.push(
      Object.freeze({
        mode: modeNumber(change),
        startSeconds: change.t_start_seconds,
        endSeconds,
        startsAtLoggedChange: true,
        endsAtLoggedChange: next !== undefined,
        startEventId: change.id,
      }),
    );
  }

  return Object.freeze(segments);
}

/** Every distinct mode a segment list contains, in first-seen order. Null (unknown) is excluded. */
export function modesIn(segments: readonly ModeSegment[]): readonly number[] {
  const seen: number[] = [];
  for (const segment of segments) {
    if (segment.mode !== null && !seen.includes(segment.mode)) {
      seen.push(segment.mode);
    }
  }
  return Object.freeze(seen);
}
