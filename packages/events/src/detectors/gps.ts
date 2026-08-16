/**
 * GPS fix-loss detection.
 *
 * Reads `gps.fix_type`, which the ArduPilot adapter maps from the GPS message's Status field.
 * Fix-type values are firmware identifiers, not tuned numbers:
 *
 *   0 no GPS   1 no fix   2 2D fix   3 3D fix   4+ DGPS / RTK
 *
 * basis: spec:ardupilot-gps-status — a 3D fix is the point at which position is usable for
 * navigation, so anything below 3 is a loss. This is a documented firmware constant rather than a
 * threshold someone tuned, which is why it is not marked provisional.
 *
 * The detector reports the interval as a fact. Whether a 0.4 s dropout mattered for a given flight
 * is a Finding, evaluated against a criterion in Phase E.
 */
import type { DetectorContext, EventDetector } from '../detector.js';
import { createFlightEvent, eventId, type FlightEvent } from '../event.js';
import { findThresholdRuns } from './threshold.js';

const VERSION = '1.0.0';
const FIX_TYPE_SIGNAL = 'gps.fix_type';

/** Below this the receiver has no usable 3D position. */
export const MINIMUM_USABLE_FIX_TYPE = 3;

/**
 * Shortest dropout worth recording.
 *
 * basis: provisional — chosen so a single-sample glitch at typical 5-10 Hz GPS rates does not
 * become an event, but no flight-test document justifies this exact figure yet. It is exposed as
 * an option so a caller with a real requirement can state theirs, and it is declared provisional
 * rather than presented as settled (doc 03 §4).
 */
export const DEFAULT_MIN_FIX_LOSS_SECONDS = 0.2;

export interface GpsFixLossOptions {
  readonly minDurationSeconds?: number;
}

export function createGpsFixLossDetector(options: GpsFixLossOptions = {}): EventDetector {
  const minDurationSeconds = options.minDurationSeconds ?? DEFAULT_MIN_FIX_LOSS_SECONDS;
  const detector = { name: 'events:gps-fix-loss', version: VERSION };

  return {
    ...detector,
    detect(context: DetectorContext): FlightEvent[] {
      const signal = context.dataset.signals.get(FIX_TYPE_SIGNAL);
      // A log without GPS logging is a normal condition, not an error: nothing to report.
      if (signal === undefined) {
        return [];
      }

      const runs = findThresholdRuns(signal, {
        threshold: MINIMUM_USABLE_FIX_TYPE,
        direction: 'below',
        minDurationSeconds,
      });

      return runs.map((run, index) =>
        createFlightEvent({
          id: eventId(detector, 'gps-fix-loss', run.startSeconds, index),
          type: 'gps-fix-loss',
          t_start_seconds: run.startSeconds,
          t_end_seconds: run.endSeconds,
          sourceSignalIds: [FIX_TYPE_SIGNAL],
          detector,
          payload: {
            worstFixType: run.extremeValue,
            durationSeconds: run.endSeconds - run.startSeconds,
            sampleCount: run.sampleCount,
            containsGap: run.containsGap,
            thresholdFixType: MINIMUM_USABLE_FIX_TYPE,
            thresholdBasis: 'spec:ardupilot-gps-status',
            minDurationSeconds,
            minDurationBasis: 'provisional',
          },
        }),
      );
    },
  };
}

export const GPS_FIX_LOSS_DETECTOR: EventDetector = createGpsFixLossDetector();
