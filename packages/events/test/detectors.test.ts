/**
 * Detector behaviour — 05_IMPLEMENTATION_ROADMAP.md Phase D acceptance.
 *
 * > Each detector has nominal/boundary/malformed/missing-data/extreme-value tests (doc 04 §5).
 *
 * Each detector below has a describe block covering those five cases explicitly.
 */
import { describe, expect, it } from 'vitest';

import {
  ARM_DISARM_DETECTOR,
  createGpsFixLossDetector,
  createVibrationExcursionDetector,
  GPS_FIX_LOSS_DETECTOR,
  LOGGED_ERROR_DETECTOR,
  MINIMUM_USABLE_FIX_TYPE,
  MODE_CHANGE_DETECTOR,
  VIBRATION_EXCURSION_DETECTOR,
} from '@pandalog/events';

import { datasetOf, missing, series, signalOf, unsupported, valid } from './support/datasets.js';

// ---------------------------------------------------------------------------------------------
// Mode change
// ---------------------------------------------------------------------------------------------
describe('mode-change detector', () => {
  it('nominal: emits one event per logged mode change', () => {
    const dataset = datasetOf(
      [],
      [
        { t_rel_seconds: 0, type: 'mode-change', payload: { Mode: 0 } },
        { t_rel_seconds: 5, type: 'mode-change', payload: { Mode: 5 } },
      ],
    );

    const events = MODE_CHANGE_DETECTOR.detect({ dataset });

    expect(events).toHaveLength(2);
    expect(events[1]?.t_start_seconds).toBe(5);
    expect(events[0]?.type).toBe('mode-change');
  });

  it('nominal: carries the logged payload through without interpreting it', () => {
    const dataset = datasetOf(
      [],
      [{ t_rel_seconds: 1, type: 'mode-change', payload: { Mode: 5 } }],
    );

    expect(MODE_CHANGE_DETECTOR.detect({ dataset })[0]?.payload).toEqual({
      source: 'sourceEvent:mode-change',
      Mode: 5,
    });
  });

  it('missing data: a log with no mode changes yields nothing, not an error', () => {
    expect(MODE_CHANGE_DETECTOR.detect({ dataset: datasetOf([], []) })).toEqual([]);
  });

  it('malformed: ignores source events of other types', () => {
    const dataset = datasetOf([], [{ t_rel_seconds: 1, type: 'error', payload: {} }]);

    expect(MODE_CHANGE_DETECTOR.detect({ dataset })).toEqual([]);
  });

  it('boundary: a mode change at t=0 is still an event', () => {
    const dataset = datasetOf([], [{ t_rel_seconds: 0, type: 'mode-change', payload: {} }]);

    expect(MODE_CHANGE_DETECTOR.detect({ dataset })).toHaveLength(1);
  });

  it('extreme: handles many changes without collapsing their ids', () => {
    const sourceEvents = Array.from({ length: 500 }, (_unused, index) => ({
      t_rel_seconds: index * 0.01,
      type: 'mode-change',
      payload: { Mode: index % 7 },
    }));

    const events = MODE_CHANGE_DETECTOR.detect({ dataset: datasetOf([], sourceEvents) });

    expect(new Set(events.map((event) => event.id)).size).toBe(500);
  });

  it('cites no source signals, because the log recorded this itself', () => {
    const dataset = datasetOf([], [{ t_rel_seconds: 1, type: 'mode-change', payload: {} }]);

    expect(MODE_CHANGE_DETECTOR.detect({ dataset })[0]?.sourceSignalIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Arm / disarm
// ---------------------------------------------------------------------------------------------
describe('arm-disarm detector', () => {
  const armEvents = (codes: number[]) =>
    datasetOf(
      [],
      codes.map((code, index) => ({
        t_rel_seconds: index,
        type: 'event',
        payload: { Id: code },
      })),
    );

  it('nominal: recognises arm and disarm codes', () => {
    const events = ARM_DISARM_DETECTOR.detect({ dataset: armEvents([10, 11]) });

    expect(events.map((event) => event.type)).toEqual(['arm', 'disarm']);
  });

  it('malformed: ignores event codes it does not know rather than guessing', () => {
    expect(ARM_DISARM_DETECTOR.detect({ dataset: armEvents([99]) })).toEqual([]);
  });

  it('missing data: no EV records yields nothing', () => {
    expect(ARM_DISARM_DETECTOR.detect({ dataset: datasetOf([], []) })).toEqual([]);
  });

  it('boundary: an unpaired arm is still reported, since a log can end mid-flight', () => {
    const events = ARM_DISARM_DETECTOR.detect({ dataset: armEvents([10]) });

    expect(events).toHaveLength(1);
    expect(events[0]?.t_end_seconds).toBeNull();
  });

  it('extreme: alternating arm/disarm cycles all survive', () => {
    const codes = Array.from({ length: 100 }, (_unused, index) => (index % 2 === 0 ? 10 : 11));

    expect(ARM_DISARM_DETECTOR.detect({ dataset: armEvents(codes) })).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------------------------
// GPS fix loss
// ---------------------------------------------------------------------------------------------
describe('gps-fix-loss detector', () => {
  const withFix = (values: (number | null)[]) => datasetOf([series('gps.fix_type', values, 0.2)]);

  it('nominal: reports the interval where the fix drops below 3D', () => {
    const events = GPS_FIX_LOSS_DETECTOR.detect({
      dataset: withFix([3, 3, 1, 1, 1, 3, 3]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.t_start_seconds).toBeCloseTo(0.4, 9);
    expect(events[0]?.t_end_seconds).toBeCloseTo(0.8, 9);
    expect(events[0]?.payload.worstFixType).toBe(1);
  });

  it('nominal: cites the signal it used (doc 03 §2)', () => {
    const events = GPS_FIX_LOSS_DETECTOR.detect({ dataset: withFix([3, 1, 1, 1, 3]) });

    expect(events[0]?.sourceSignalIds).toEqual(['gps.fix_type']);
  });

  it('boundary: a fix of exactly 3 is usable and is not a loss', () => {
    expect(GPS_FIX_LOSS_DETECTOR.detect({ dataset: withFix([3, 3, 3]) })).toEqual([]);
    expect(MINIMUM_USABLE_FIX_TYPE).toBe(3);
  });

  it('boundary: a dropout shorter than the minimum duration is noise, not an event', () => {
    // One sample at 0.2 s spacing spans 0 s, below the 0.2 s default.
    expect(GPS_FIX_LOSS_DETECTOR.detect({ dataset: withFix([3, 1, 3]) })).toEqual([]);
  });

  it('boundary: a dropout exactly at the minimum duration is reported', () => {
    const detector = createGpsFixLossDetector({ minDurationSeconds: 0.2 });

    expect(detector.detect({ dataset: withFix([3, 1, 1, 3]) })).toHaveLength(1);
  });

  it('missing data: a log with no GPS signal yields nothing, not an error', () => {
    expect(GPS_FIX_LOSS_DETECTOR.detect({ dataset: datasetOf([]) })).toEqual([]);
  });

  it('missing data: a gap inside a dropout keeps the interval open and records the gap', () => {
    // The gap is an absence of evidence, not evidence the fix recovered.
    const events = GPS_FIX_LOSS_DETECTOR.detect({
      dataset: withFix([3, 1, null, 1, 1, 3]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.containsGap).toBe(true);
    expect(events[0]?.t_end_seconds).toBeCloseTo(0.8, 9);
  });

  it('missing data: UNSUPPORTED samples never open an interval', () => {
    const dataset = datasetOf([
      signalOf('gps.fix_type', [unsupported(0), unsupported(1), unsupported(2)]),
    ]);

    expect(GPS_FIX_LOSS_DETECTOR.detect({ dataset })).toEqual([]);
  });

  it('malformed: an empty signal yields nothing', () => {
    expect(
      GPS_FIX_LOSS_DETECTOR.detect({ dataset: datasetOf([signalOf('gps.fix_type', [])]) }),
    ).toEqual([]);
  });

  it('extreme: a fix lost for the whole log is one interval, not many', () => {
    const events = GPS_FIX_LOSS_DETECTOR.detect({
      dataset: withFix(Array.from({ length: 200 }, () => 0)),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.sampleCount).toBe(200);
  });

  it('reports two separate dropouts as two events', () => {
    const events = GPS_FIX_LOSS_DETECTOR.detect({
      dataset: withFix([3, 1, 1, 3, 3, 1, 1, 3]),
    });

    expect(events).toHaveLength(2);
  });

  it('declares the basis of each threshold it used (doc 03 §4)', () => {
    const events = GPS_FIX_LOSS_DETECTOR.detect({ dataset: withFix([3, 1, 1, 3]) });

    expect(events[0]?.payload.thresholdBasis).toBe('spec:ardupilot-gps-status');
    expect(events[0]?.payload.minDurationBasis).toBe('provisional');
  });
});

// ---------------------------------------------------------------------------------------------
// Vibration excursion
// ---------------------------------------------------------------------------------------------
describe('vibration-excursion detector', () => {
  const withVibration = (x: (number | null)[], y?: (number | null)[], z?: (number | null)[]) =>
    datasetOf([
      series('vibration.x', x, 0.1, 'm/s^2'),
      series('vibration.y', y ?? x.map(() => 0), 0.1, 'm/s^2'),
      series('vibration.z', z ?? x.map(() => 0), 0.1, 'm/s^2'),
    ]);

  it('nominal: reports a sustained excursion above the threshold', () => {
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration([5, 5, 40, 45, 41, 40, 39, 38, 5, 5]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.peakMagnitude).toBeCloseTo(45, 6);
  });

  it('nominal: cites all three axes', () => {
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration([40, 41, 42, 43, 44, 45, 5]),
    });

    expect(events[0]?.sourceSignalIds).toEqual(['vibration.x', 'vibration.y', 'vibration.z']);
  });

  it('nominal: records the derivation used, so the magnitude is reproducible', () => {
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration([40, 41, 42, 43, 44, 45, 5]),
    });

    expect(events[0]?.payload.derivation).toMatchObject({ method: 'query:magnitude3' });
  });

  it('nominal: combines the axes rather than tripping on one', () => {
    // 20/20/20 alone is under threshold on each axis but sqrt(3*400) = 34.6 combined.
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration(
        [20, 20, 20, 20, 20, 20, 20],
        [20, 20, 20, 20, 20, 20, 20],
        [20, 20, 20, 20, 20, 20, 20],
      ),
    });

    expect(events).toHaveLength(1);
  });

  it('boundary: exactly at the threshold is not an excursion', () => {
    const detector = createVibrationExcursionDetector({
      thresholdMetresPerSecondSquared: 30,
      minDurationSeconds: 0.1,
    });

    expect(detector.detect({ dataset: withVibration([30, 30, 30, 30, 30, 30]) })).toEqual([]);
  });

  it('boundary: a spike shorter than the minimum duration is not an event', () => {
    expect(VIBRATION_EXCURSION_DETECTOR.detect({ dataset: withVibration([5, 90, 5]) })).toEqual([]);
  });

  it('missing data: no vibration logging yields nothing', () => {
    expect(VIBRATION_EXCURSION_DETECTOR.detect({ dataset: datasetOf([]) })).toEqual([]);
  });

  it('missing data: a partially logged axis set yields nothing rather than a partial magnitude', () => {
    const dataset = datasetOf([series('vibration.x', [40, 40, 40, 40, 40, 40], 0.1, 'm/s^2')]);

    expect(VIBRATION_EXCURSION_DETECTOR.detect({ dataset })).toEqual([]);
  });

  it('missing data: a gap inside an excursion keeps it open and records the gap', () => {
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration([40, 40, null, 40, 40, 40, 40, 5]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.containsGap).toBe(true);
  });

  it('malformed: axes of unequal length yield nothing rather than an invented alignment', () => {
    const dataset = datasetOf([
      series('vibration.x', [40, 40, 40], 0.1, 'm/s^2'),
      series('vibration.y', [0, 0], 0.1, 'm/s^2'),
      series('vibration.z', [0, 0], 0.1, 'm/s^2'),
    ]);

    expect(VIBRATION_EXCURSION_DETECTOR.detect({ dataset })).toEqual([]);
  });

  it('extreme: a very large magnitude is carried through rather than clamped', () => {
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration([1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6]),
    });

    expect(events[0]?.payload.peakMagnitude).toBeCloseTo(1e6, 0);
    expect(Number.isFinite(events[0]?.payload.peakMagnitude as number)).toBe(true);
  });

  it('declares the threshold as provisional, not as settled engineering (doc 03 §4)', () => {
    const events = VIBRATION_EXCURSION_DETECTOR.detect({
      dataset: withVibration([40, 41, 42, 43, 44, 45, 5]),
    });

    expect(events[0]?.payload.thresholdBasis).toBe('provisional');
    expect(events[0]?.payload.thresholdUnit).toBe('m/s^2');
  });

  it('honours a caller-supplied threshold', () => {
    const detector = createVibrationExcursionDetector({
      thresholdMetresPerSecondSquared: 10,
      minDurationSeconds: 0.1,
    });

    expect(detector.detect({ dataset: withVibration([15, 15, 15, 15, 5]) })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Logged errors
// ---------------------------------------------------------------------------------------------
describe('logged-error detector', () => {
  it('nominal: reports each logged error as a fact, without judging it', () => {
    const dataset = datasetOf(
      [],
      [{ t_rel_seconds: 2, type: 'error', payload: { Subsys: 11, ECode: 2 } }],
    );

    const events = LOGGED_ERROR_DETECTOR.detect({ dataset });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('logged-error');
    // No severity anywhere: that is a Finding's job (doc 03 §1).
    expect(events[0]?.payload).not.toHaveProperty('severity');
  });

  it('missing data: no errors logged yields nothing', () => {
    expect(LOGGED_ERROR_DETECTOR.detect({ dataset: datasetOf([], []) })).toEqual([]);
  });
});

describe('threshold runs treat a leading gap correctly', () => {
  it('does not start an interval on missing data', () => {
    const dataset = datasetOf([
      signalOf('gps.fix_type', [missing(0), missing(0.2), valid(0.4, 3)]),
    ]);

    expect(GPS_FIX_LOSS_DETECTOR.detect({ dataset })).toEqual([]);
  });
});
