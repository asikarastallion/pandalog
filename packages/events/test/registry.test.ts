/** Detector contract, registry and event construction — doc 03 §2, doc 05 Phase D. */
import { describe, expect, it } from 'vitest';

import {
  createDefaultDetectorRegistry,
  createDetectorRegistry,
  createFlightEvent,
  detectEvents,
  eventId,
  EventsError,
  type EventDetector,
} from '@pandalog/events';

import { datasetOf } from './support/datasets.js';

const detector = { name: 'events:test', version: '1.0.0' };

const stub = (name: string, times: number[]): EventDetector => ({
  name,
  version: '1.0.0',
  detect: () =>
    times.map((t, index) =>
      createFlightEvent({
        id: eventId({ name, version: '1.0.0' }, 'stub', t, index),
        type: 'stub',
        t_start_seconds: t,
        detector: { name, version: '1.0.0' },
      }),
    ),
});

describe('createFlightEvent', () => {
  it('builds a frozen event with the fields doc 03 §2 requires', () => {
    const event = createFlightEvent({
      id: 'e1',
      type: 'gps-fix-loss',
      t_start_seconds: 1,
      t_end_seconds: 2,
      sourceSignalIds: ['gps.fix_type'],
      detector,
      payload: { worstFixType: 1 },
    });

    expect(Object.isFrozen(event)).toBe(true);
    expect(event.sourceSignalIds).toEqual(['gps.fix_type']);
    expect(event.detector).toEqual(detector);
  });

  it('defaults an instantaneous event to a null end time', () => {
    expect(
      createFlightEvent({ id: 'e', type: 't', t_start_seconds: 0, detector }).t_end_seconds,
    ).toBeNull();
  });

  it('carries no severity or outcome field — that distinction is doc 03 §1', () => {
    const event = createFlightEvent({ id: 'e', type: 't', t_start_seconds: 0, detector });

    expect(event).not.toHaveProperty('severity');
    expect(event).not.toHaveProperty('verificationStatus');
  });

  describe('rejects events that could not be placed or traced', () => {
    it.each([
      ['an empty id', { id: '', type: 't', t_start_seconds: 0, detector }],
      ['an empty type', { id: 'e', type: '', t_start_seconds: 0, detector }],
      ['a non-finite start', { id: 'e', type: 't', t_start_seconds: NaN, detector }],
      ['an infinite start', { id: 'e', type: 't', t_start_seconds: Infinity, detector }],
      [
        'a non-finite end',
        { id: 'e', type: 't', t_start_seconds: 0, t_end_seconds: NaN, detector },
      ],
      [
        'an end before the start',
        { id: 'e', type: 't', t_start_seconds: 5, t_end_seconds: 1, detector },
      ],
      [
        'a detector with no name',
        { id: 'e', type: 't', t_start_seconds: 0, detector: { name: '', version: '1.0.0' } },
      ],
      [
        'a non-semver detector version',
        { id: 'e', type: 't', t_start_seconds: 0, detector: { name: 'd', version: 'latest' } },
      ],
      [
        'an empty source signal id',
        { id: 'e', type: 't', t_start_seconds: 0, detector, sourceSignalIds: [''] },
      ],
    ])('rejects %s', (_label, input) => {
      expect(() => createFlightEvent(input)).toThrow(EventsError);
    });

    it('allows an end equal to the start, for a zero-length interval', () => {
      expect(() =>
        createFlightEvent({ id: 'e', type: 't', t_start_seconds: 3, t_end_seconds: 3, detector }),
      ).not.toThrow();
    });
  });
});

describe('eventId', () => {
  it('is deterministic for the same detector, type, time and ordinal', () => {
    expect(eventId(detector, 'x', 1.5, 0)).toBe(eventId(detector, 'x', 1.5, 0));
  });

  it('distinguishes events a detector emits at the same instant', () => {
    expect(eventId(detector, 'x', 1.5, 0)).not.toBe(eventId(detector, 'x', 1.5, 1));
  });
});

describe('the registry', () => {
  it('is immutable: withDetector returns a new registry', () => {
    const original = createDetectorRegistry();
    const extended = original.withDetector(stub('a', [0]));

    expect(original.detectors).toHaveLength(0);
    expect(extended.detectors).toHaveLength(1);
  });

  it('rejects two detectors sharing a name', () => {
    expect(() => createDetectorRegistry([stub('a', []), stub('a', [])])).toThrow(EventsError);
  });

  it('rejects a detector with no name', () => {
    expect(() => createDetectorRegistry([stub('', [])])).toThrow(EventsError);
  });

  it('looks a detector up by name', () => {
    expect(createDetectorRegistry([stub('a', [])]).get('a')?.name).toBe('a');
    expect(createDetectorRegistry([stub('a', [])]).get('b')).toBeNull();
  });

  it('ships the detectors Phase D calls for', () => {
    expect(
      createDefaultDetectorRegistry()
        .detectors.map((entry) => entry.name)
        .sort(),
    ).toEqual([
      'events:arm-disarm',
      'events:gps-fix-loss',
      'events:logged-error',
      'events:logged-message',
      'events:mode-change',
      'events:vibration-excursion',
    ]);
  });
});

describe('detectEvents', () => {
  const dataset = datasetOf([]);

  it('returns events sorted by time regardless of registration order', () => {
    const forward = detectEvents(createDetectorRegistry([stub('a', [5]), stub('b', [1])]), {
      dataset,
    });
    const reversed = detectEvents(createDetectorRegistry([stub('b', [1]), stub('a', [5])]), {
      dataset,
    });

    expect(forward.map((event) => event.t_start_seconds)).toEqual([1, 5]);
    expect(forward.map((event) => event.id)).toEqual(reversed.map((event) => event.id));
  });

  it('is deterministic across repeated runs (doc 03 §6)', () => {
    const registry = createDetectorRegistry([stub('a', [1, 2]), stub('b', [1.5])]);

    expect(JSON.stringify(detectEvents(registry, { dataset }))).toBe(
      JSON.stringify(detectEvents(registry, { dataset })),
    );
  });

  it('returns nothing for an empty registry', () => {
    expect(detectEvents(createDetectorRegistry(), { dataset })).toEqual([]);
  });
});
