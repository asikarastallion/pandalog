/**
 * `@pandalog/events` — flight event detection.
 *
 * Layer 5. An event is a fact: a discrete, timestamped occurrence detected from measurements or
 * read from the log's own records. Nothing here decides whether an event was a problem — that is a
 * Finding, and keeping the two apart is doc 03 §1's central point.
 */

export { EventsError } from './errors.js';
export type { EventsErrorCode } from './errors.js';

export { createFlightEvent, eventId } from './event.js';
export type { CreateFlightEventInput, DetectorIdentity, FlightEvent } from './event.js';

export { createDetectorRegistry, detectEvents } from './detector.js';
export type { DetectorContext, DetectorRegistry, EventDetector } from './detector.js';

export { findThresholdRuns } from './detectors/threshold.js';
export type { ThresholdOptions, ThresholdRun } from './detectors/threshold.js';

export {
  ARM_DISARM_DETECTOR,
  LOGGED_ERROR_DETECTOR,
  LOGGED_MESSAGE_DETECTOR,
  MODE_CHANGE_DETECTOR,
  SOURCE_LOG_DETECTORS,
} from './detectors/source-log.js';

export {
  createGpsFixLossDetector,
  DEFAULT_MIN_FIX_LOSS_SECONDS,
  GPS_FIX_LOSS_DETECTOR,
  MINIMUM_USABLE_FIX_TYPE,
} from './detectors/gps.js';
export type { GpsFixLossOptions } from './detectors/gps.js';

export {
  createVibrationExcursionDetector,
  DEFAULT_MIN_VIBRATION_SECONDS,
  DEFAULT_VIBRATION_THRESHOLD_M_PER_S2,
  VIBRATION_EXCURSION_DETECTOR,
} from './detectors/vibration.js';
export type { VibrationExcursionOptions } from './detectors/vibration.js';

import { createDetectorRegistry } from './detector.js';
import { GPS_FIX_LOSS_DETECTOR } from './detectors/gps.js';
import { SOURCE_LOG_DETECTORS } from './detectors/source-log.js';
import { VIBRATION_EXCURSION_DETECTOR } from './detectors/vibration.js';

/** The detectors doc 05 Phase D calls for, with their default thresholds. */
export const createDefaultDetectorRegistry = () =>
  createDetectorRegistry([
    ...SOURCE_LOG_DETECTORS,
    GPS_FIX_LOSS_DETECTOR,
    VIBRATION_EXCURSION_DETECTOR,
  ]);
