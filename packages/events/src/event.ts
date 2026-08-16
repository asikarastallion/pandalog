/**
 * FlightEvent — 03_ANALYSIS_AND_VERIFICATION.md §2.
 *
 * An event is still a *fact*: a discrete, timestamped occurrence detected from measurements. It is
 * not a claim about whether anything was wrong — that is a Finding, and doc 03 §1 identifies
 * collapsing the two as the most common way this class of tool becomes untrustworthy. Nothing here
 * carries a severity or a pass/fail.
 */
import { EventsError } from './errors.js';

export interface DetectorIdentity {
  readonly name: string;
  /** Semver; a detector whose behaviour changes is a version bump, so events stay traceable. */
  readonly version: string;
}

export interface FlightEvent {
  readonly id: string;
  readonly type: string; // e.g. "mode-change", "gps-fix-loss", "vibration-excursion"
  readonly t_start_seconds: number;
  /** Null for an instantaneous event. */
  readonly t_end_seconds: number | null;
  /**
   * Signals this event was detected from (doc 03 §2).
   *
   * Empty is meaningful, not lazy: events carried by the log itself — a mode change, a logged
   * error — are read from `CanonicalFlightDataset.sourceEvents`, not derived from any signal. Such
   * a detector records its origin in `payload.source` instead. A *signal-based* detector with an
   * empty list would be unable to justify itself, and `createFlightEvent` is where that is caught.
   */
  readonly sourceSignalIds: readonly string[];
  readonly detector: DetectorIdentity;
  readonly payload: Readonly<Record<string, unknown>>;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface CreateFlightEventInput {
  readonly id: string;
  readonly type: string;
  readonly t_start_seconds: number;
  readonly t_end_seconds?: number | null;
  readonly sourceSignalIds?: readonly string[];
  readonly detector: DetectorIdentity;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * Build a validated, frozen event.
 *
 * @throws {EventsError} when the event could not be placed on the timeline or traced to a detector.
 */
export function createFlightEvent(input: CreateFlightEventInput): FlightEvent {
  const fail = (message: string, context: Record<string, unknown> = {}): never => {
    throw new EventsError('INVALID_EVENT', message, { id: input.id, type: input.type, ...context });
  };

  if (input.id.length === 0) {
    fail('A flight event needs a non-empty id.');
  }
  if (input.type.length === 0) {
    fail('A flight event needs a non-empty type.');
  }
  if (!Number.isFinite(input.t_start_seconds)) {
    fail(`t_start_seconds must be finite, got ${String(input.t_start_seconds)}.`);
  }

  const end = input.t_end_seconds ?? null;
  if (end !== null) {
    if (!Number.isFinite(end)) {
      fail(`t_end_seconds must be finite or null, got ${String(end)}.`);
    }
    if (end < input.t_start_seconds) {
      fail(
        `t_end_seconds ${String(end)} precedes t_start_seconds ${String(input.t_start_seconds)}; ` +
          'an event cannot end before it begins.',
      );
    }
  }

  if (input.detector.name.length === 0) {
    fail('A flight event must name the detector that produced it.');
  }
  if (!SEMVER_RE.test(input.detector.version)) {
    fail(
      `Detector ${input.detector.name} declares version ${JSON.stringify(input.detector.version)}, ` +
        'which is not semver. Versions are what keep an event traceable to the logic that found it.',
    );
  }

  const sourceSignalIds = input.sourceSignalIds ?? [];
  if (sourceSignalIds.some((id) => id.length === 0)) {
    fail('sourceSignalIds must not contain an empty id.');
  }

  return Object.freeze({
    id: input.id,
    type: input.type,
    t_start_seconds: input.t_start_seconds,
    t_end_seconds: end,
    sourceSignalIds: Object.freeze([...sourceSignalIds]),
    detector: Object.freeze({ ...input.detector }),
    payload: Object.freeze({ ...input.payload }),
  });
}

/**
 * Deterministic event id.
 *
 * Built from the detector, the type and the start time so re-running detection over the same
 * dataset produces identical ids — which is what makes a Finding's evidence reference stable
 * across runs (doc 03 §6). The ordinal disambiguates events a detector emits at the same instant.
 */
export function eventId(
  detector: DetectorIdentity,
  type: string,
  startSeconds: number,
  ordinal: number,
): string {
  return `${detector.name}:${type}@${startSeconds.toFixed(6)}#${String(ordinal)}`;
}
