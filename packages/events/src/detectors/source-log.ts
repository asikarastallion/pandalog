/**
 * Detectors for events the log carries itself.
 *
 * These read `CanonicalFlightDataset.sourceEvents` rather than signals: the vehicle already
 * recorded that a mode changed or an error fired, so detecting it means reading it, not inferring
 * it. They therefore report an empty `sourceSignalIds` and record their origin in
 * `payload.source` — see the note on that field in `event.ts`.
 *
 * Nothing here interprets severity. A logged error becomes an event that says an error was logged;
 * whether it matters is a Finding, and that is Phase E's job (doc 03 §1).
 */
import type { SourceEvent } from '@pandalog/schema';

import type { DetectorContext, EventDetector } from '../detector.js';
import { createFlightEvent, eventId, type FlightEvent } from '../event.js';

const VERSION = '1.0.0';

/**
 * ArduPilot EV subsystem codes for arming state.
 *
 * basis: spec:ardupilot-LogStructure — these are fixed identifiers in the firmware's event table,
 * not tuned thresholds. A code the table does not cover is left alone rather than guessed at.
 */
const ARMED_EVENT_CODE = 10;
const DISARMED_EVENT_CODE = 11;

function eventsOfType(context: DetectorContext, type: string): SourceEvent[] {
  return context.dataset.sourceEvents.filter((event) => event.type === type);
}

function fromSourceEvents(
  detector: { name: string; version: string },
  sourceType: string,
  eventType: string,
): EventDetector {
  return {
    name: detector.name,
    version: detector.version,
    detect(context: DetectorContext): FlightEvent[] {
      return eventsOfType(context, sourceType).map((source, index) =>
        createFlightEvent({
          id: eventId(detector, eventType, source.t_rel_seconds, index),
          type: eventType,
          t_start_seconds: source.t_rel_seconds,
          t_end_seconds: null,
          sourceSignalIds: [],
          detector,
          payload: { source: `sourceEvent:${sourceType}`, ...source.payload },
        }),
      );
    },
  };
}

/** Every mode change the log recorded, as an instantaneous event. */
export const MODE_CHANGE_DETECTOR: EventDetector = fromSourceEvents(
  { name: 'events:mode-change', version: VERSION },
  'mode-change',
  'mode-change',
);

/** Errors the firmware logged. Reported as facts; their significance is a Finding, not an event. */
export const LOGGED_ERROR_DETECTOR: EventDetector = fromSourceEvents(
  { name: 'events:logged-error', version: VERSION },
  'error',
  'logged-error',
);

/** Text messages the firmware logged, e.g. the firmware banner. */
export const LOGGED_MESSAGE_DETECTOR: EventDetector = fromSourceEvents(
  { name: 'events:logged-message', version: VERSION },
  'message',
  'logged-message',
);

/**
 * Arm and disarm, from the firmware's own event codes.
 *
 * Emitted as instantaneous events rather than as one armed *interval*, because a log can begin or
 * end mid-flight: pairing them into an interval would require inventing a boundary the log does
 * not contain. A consumer wanting the armed window can pair the events and decide for itself what
 * an unpaired one means.
 */
export const ARM_DISARM_DETECTOR: EventDetector = {
  name: 'events:arm-disarm',
  version: VERSION,
  detect(context: DetectorContext): FlightEvent[] {
    const detector = { name: 'events:arm-disarm', version: VERSION };
    const events: FlightEvent[] = [];

    for (const [index, source] of eventsOfType(context, 'event').entries()) {
      const code = source.payload.Id;
      const type =
        code === ARMED_EVENT_CODE ? 'arm' : code === DISARMED_EVENT_CODE ? 'disarm' : null;

      if (type === null) {
        continue;
      }

      events.push(
        createFlightEvent({
          id: eventId(detector, type, source.t_rel_seconds, index),
          type,
          t_start_seconds: source.t_rel_seconds,
          t_end_seconds: null,
          sourceSignalIds: [],
          detector,
          payload: { source: 'sourceEvent:event', eventCode: code },
        }),
      );
    }

    return events;
  },
};

export const SOURCE_LOG_DETECTORS: readonly EventDetector[] = Object.freeze([
  MODE_CHANGE_DETECTOR,
  LOGGED_ERROR_DETECTOR,
  LOGGED_MESSAGE_DETECTOR,
  ARM_DISARM_DETECTOR,
]);
