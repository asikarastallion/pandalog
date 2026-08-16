/** Signal selection — 05_IMPLEMENTATION_ROADMAP.md Phase C. */
import { describe, expect, it } from 'vitest';

import { createCanonicalFlightDataset, createSignal, createTimeBase } from '@pandalog/core-domain';
import {
  matchesPattern,
  selectSignal,
  selectSignals,
  sliceByTime,
  timeSpanOf,
  valueBearingSamples,
} from '@pandalog/query';
import { Validity, type Signal } from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });

const signalOf = (id: string, times: number[] = [0, 1, 2]): Signal =>
  createSignal({
    id,
    unit: 'rad',
    sourceUnit: 'deg',
    timeBase,
    samples: times.map((t) => ({ t_rel_seconds: t, value: t, validity: Validity.VALID })),
  });

const dataset = createCanonicalFlightDataset({
  provenance: {
    fileName: 'f.bin',
    sha256: 'b'.repeat(64),
    sizeBytes: 10,
    format: 'synthetic',
    parserPackage: '@pandalog/query-test',
    parserVersion: '0.1.0',
    ingestedAtUtc: '2026-01-01T00:00:00.000Z',
  },
  vehicle: { frameClass: null, firmwareVersion: null, firmwareHash: null },
  timeBase,
  signals: [
    signalOf('attitude.roll'),
    signalOf('attitude.pitch'),
    signalOf('imu.gyro.x'),
    signalOf('imu.gyro.y'),
  ],
});

describe('selectSignal', () => {
  it('finds a signal by exact id', () => {
    expect(selectSignal(dataset, 'attitude.roll')?.id).toBe('attitude.roll');
  });

  it('returns null rather than throwing for an unknown id', () => {
    expect(selectSignal(dataset, 'nope')).toBeNull();
  });
});

describe('matchesPattern', () => {
  it.each([
    ['attitude.roll', 'attitude.*', true],
    ['attitude.roll', '*.roll', true],
    ['attitude.roll', 'attitude.roll', true],
    ['attitude.roll', 'imu.*', false],
    ['imu.gyro.x', 'imu.*', false],
    ['imu.gyro.x', 'imu.**', true],
    ['attitude', 'attitude.*', false],
    ['attitude.roll.filtered', 'attitude.*', false],
  ])('%s vs %s -> %s', (id, pattern, expected) => {
    expect(matchesPattern(id, pattern)).toBe(expected);
  });

  it('does not let a pattern metacharacter escape into the regex', () => {
    expect(matchesPattern('a.b', 'a+b')).toBe(false);
  });
});

describe('selectSignals', () => {
  it('returns matching signals in stable id order', () => {
    expect(selectSignals(dataset, 'attitude.*').map((signal) => signal.id)).toEqual([
      'attitude.pitch',
      'attitude.roll',
    ]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(selectSignals(dataset, 'baro.*')).toEqual([]);
  });
});

describe('sliceByTime', () => {
  it('keeps only samples inside the inclusive window', () => {
    const sliced = sliceByTime(signalOf('a', [0, 1, 2, 3]), { startSeconds: 1, endSeconds: 2 });

    expect(sliced.samples.map((sample) => sample.t_rel_seconds)).toEqual([1, 2]);
  });

  it('includes samples exactly on the boundaries', () => {
    const sliced = sliceByTime(signalOf('a', [0, 1, 2]), { startSeconds: 0, endSeconds: 2 });

    expect(sliced.samples).toHaveLength(3);
  });

  it('returns an empty signal when the window misses the data', () => {
    const sliced = sliceByTime(signalOf('a', [0, 1]), { startSeconds: 5, endSeconds: 6 });

    expect(sliced.samples).toHaveLength(0);
  });

  it('does not mutate the source signal', () => {
    const original = signalOf('a', [0, 1, 2]);
    sliceByTime(original, { startSeconds: 1, endSeconds: 1 });

    expect(original.samples).toHaveLength(3);
  });

  it('preserves unit and time base', () => {
    const sliced = sliceByTime(signalOf('a'), { startSeconds: 0, endSeconds: 1 });

    expect(sliced.unit).toBe('rad');
    expect(sliced.timeBase).toEqual(timeBase);
  });
});

describe('timeSpanOf', () => {
  it('reports first and last sample times', () => {
    expect(timeSpanOf(signalOf('a', [1, 4, 9]))).toEqual({ startSeconds: 1, endSeconds: 9 });
  });

  it('returns null for an empty signal', () => {
    expect(timeSpanOf(signalOf('a', []))).toBeNull();
  });
});

describe('valueBearingSamples', () => {
  it('keeps VALID and INTERPOLATED, drops the rest (ADR-0007)', () => {
    const signal = createSignal({
      id: 'a',
      unit: 'm',
      sourceUnit: 'm',
      timeBase,
      samples: [
        { t_rel_seconds: 0, value: 1, validity: Validity.VALID },
        { t_rel_seconds: 1, value: 2, validity: Validity.INTERPOLATED },
        { t_rel_seconds: 2, value: NaN, validity: Validity.MISSING },
        { t_rel_seconds: 3, value: NaN, validity: Validity.UNSUPPORTED },
        { t_rel_seconds: 4, value: NaN, validity: Validity.INVALID },
      ],
    });

    expect(valueBearingSamples(signal).map((sample) => sample.t_rel_seconds)).toEqual([0, 1]);
  });
});
