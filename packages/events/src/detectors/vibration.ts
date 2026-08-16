/**
 * Vibration excursion detection.
 *
 * Derives the vibration vector magnitude from `vibration.x/y/z` through `@pandalog/query`'s
 * registry, so the derivation is recorded with its method and version rather than computed inline
 * — the same number could then be reproduced from the dataset alone (doc 02 §5).
 *
 * **The threshold is provisional and says so.** 30 m/s^2 is widely used as a rule of thumb for
 * where ArduPilot vibration becomes concerning, but no flight-test document in this repository
 * justifies it, and the right figure depends on airframe, mounting and payload. Doc 03 §4 requires
 * a rule that has not established its numbers to declare that rather than present them as settled,
 * so the basis travels in the event payload and a caller can supply their own.
 */
import { createDerivationRegistry, deriveSignal } from '@pandalog/query';
import type { Signal } from '@pandalog/schema';

import type { DetectorContext, EventDetector } from '../detector.js';
import { createFlightEvent, eventId, type FlightEvent } from '../event.js';
import { findThresholdRuns } from './threshold.js';

const VERSION = '1.0.0';
const AXIS_SIGNALS = ['vibration.x', 'vibration.y', 'vibration.z'] as const;
const MAGNITUDE_ID = 'vibration.magnitude';

/** basis: provisional — see the module note. */
export const DEFAULT_VIBRATION_THRESHOLD_M_PER_S2 = 30;
/** basis: provisional — long enough that a single sample spike is not an event. */
export const DEFAULT_MIN_VIBRATION_SECONDS = 0.5;

export interface VibrationExcursionOptions {
  readonly thresholdMetresPerSecondSquared?: number;
  readonly minDurationSeconds?: number;
}

export function createVibrationExcursionDetector(
  options: VibrationExcursionOptions = {},
): EventDetector {
  const threshold = options.thresholdMetresPerSecondSquared ?? DEFAULT_VIBRATION_THRESHOLD_M_PER_S2;
  const minDurationSeconds = options.minDurationSeconds ?? DEFAULT_MIN_VIBRATION_SECONDS;
  const detector = { name: 'events:vibration-excursion', version: VERSION };
  const derivations = createDerivationRegistry();

  return {
    ...detector,
    detect(context: DetectorContext): FlightEvent[] {
      const axes: Signal[] = [];
      for (const id of AXIS_SIGNALS) {
        const signal = context.dataset.signals.get(id);
        // Missing vibration logging is a normal condition; report nothing rather than guessing.
        if (signal === undefined) {
          return [];
        }
        axes.push(signal);
      }

      const [first] = axes;
      if (
        first === undefined ||
        axes.some((axis) => axis.samples.length !== first.samples.length)
      ) {
        // The axes are logged in one VIBE record, so unequal lengths mean something upstream is
        // wrong. Reporting nothing is honest; inventing an alignment here would not be.
        return [];
      }

      const magnitude = deriveSignal(derivations, {
        id: MAGNITUDE_ID,
        method: 'query:magnitude3',
        inputs: axes,
      });

      const runs = findThresholdRuns(magnitude, {
        threshold,
        direction: 'above',
        minDurationSeconds,
      });

      return runs.map((run, index) =>
        createFlightEvent({
          id: eventId(detector, 'vibration-excursion', run.startSeconds, index),
          type: 'vibration-excursion',
          t_start_seconds: run.startSeconds,
          t_end_seconds: run.endSeconds,
          sourceSignalIds: [...AXIS_SIGNALS],
          detector,
          payload: {
            peakMagnitude: run.extremeValue,
            durationSeconds: run.endSeconds - run.startSeconds,
            sampleCount: run.sampleCount,
            containsGap: run.containsGap,
            threshold,
            thresholdUnit: 'm/s^2',
            thresholdBasis: 'provisional',
            minDurationSeconds,
            minDurationBasis: 'provisional',
            derivation: magnitude.derivation,
          },
        }),
      );
    },
  };
}

export const VIBRATION_EXCURSION_DETECTOR: EventDetector = createVibrationExcursionDetector();
