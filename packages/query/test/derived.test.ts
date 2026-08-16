/**
 * Derived signals — 05_IMPLEMENTATION_ROADMAP.md Phase C, 02_CANONICAL_DATA_MODEL.md §5.
 *
 * The shipped derivations are the ones Phases D and E need: attitude tracking error (difference),
 * vibration level (magnitude3) and "RMS error over a window" (rolling-rms, doc 03 §1).
 */
import { describe, expect, it } from 'vitest';

import { createSignal, createTimeBase } from '@pandalog/core-domain';
import { createDerivationRegistry, deriveSignal, QueryError } from '@pandalog/query';
import { Validity, type Sample, type Signal } from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });
const registry = createDerivationRegistry();

const signalOf = (id: string, samples: Sample[], unit: 'rad' | 'm/s^2' = 'rad'): Signal =>
  createSignal({ id, unit, sourceUnit: null, timeBase, samples });

const valid = (t: number, value: number): Sample => ({
  t_rel_seconds: t,
  value,
  validity: Validity.VALID,
});
const missing = (t: number): Sample => ({
  t_rel_seconds: t,
  value: NaN,
  validity: Validity.MISSING,
});

describe('query:difference', () => {
  const desired = signalOf('attitude.roll.desired', [valid(0, 10), valid(1, 12), valid(2, 8)]);
  const actual = signalOf('attitude.roll', [valid(0, 9), valid(1, 15), valid(2, 8)]);

  it('subtracts the second input from the first', () => {
    const error = deriveSignal(registry, {
      id: 'attitude.roll.error',
      method: 'query:difference',
      inputs: [desired, actual],
    });

    expect(error.samples.map((sample) => sample.value)).toEqual([1, -3, 0]);
  });

  it('records a reproducible derivation block naming its inputs', () => {
    const error = deriveSignal(registry, {
      id: 'attitude.roll.error',
      method: 'query:difference',
      inputs: [desired, actual],
    });

    expect(error.derived).toBe(true);
    expect(error.derivation).toEqual({
      method: 'query:difference',
      version: '1.0.0',
      inputs: ['attitude.roll.desired', 'attitude.roll'],
    });
  });

  it('keeps the inputs unit and marks the result as purely derived', () => {
    const error = deriveSignal(registry, {
      id: 'attitude.roll.error',
      method: 'query:difference',
      inputs: [desired, actual],
    });

    expect(error.unit).toBe('rad');
    expect(error.sourceUnit).toBeNull();
  });

  it('degrades to the least trustworthy input, never hiding a hole', () => {
    const withHole = signalOf('attitude.roll', [valid(0, 9), missing(1), valid(2, 8)]);

    const error = deriveSignal(registry, {
      id: 'attitude.roll.error',
      method: 'query:difference',
      inputs: [desired, withHole],
    });

    expect(error.samples[1]?.validity).toBe(Validity.MISSING);
    expect(error.samples[1]?.value).toBeNaN();
    expect(error.samples[0]?.validity).toBe(Validity.VALID);
  });

  it('marks the result INTERPOLATED when an input was interpolated', () => {
    const resampled = signalOf('attitude.roll', [
      valid(0, 9),
      { t_rel_seconds: 1, value: 11, validity: Validity.INTERPOLATED },
      valid(2, 8),
    ]);

    const error = deriveSignal(registry, {
      id: 'attitude.roll.error',
      method: 'query:difference',
      inputs: [desired, resampled],
    });

    expect(error.samples[1]?.validity).toBe(Validity.INTERPOLATED);
    expect(error.samples[1]?.value).toBe(1);
  });

  it('refuses to difference signals in different units', () => {
    const acceleration = signalOf('imu.accel.x', [valid(0, 1), valid(1, 1), valid(2, 1)], 'm/s^2');

    expect(() =>
      deriveSignal(registry, {
        id: 'nonsense',
        method: 'query:difference',
        inputs: [desired, acceleration],
      }),
    ).toThrow(QueryError);
  });
});

describe('query:magnitude3', () => {
  const axis = (id: string, values: number[]): Signal =>
    signalOf(
      id,
      values.map((value, index) => valid(index, value)),
      'm/s^2',
    );

  it('computes the vector magnitude', () => {
    const magnitude = deriveSignal(registry, {
      id: 'vibration.magnitude',
      method: 'query:magnitude3',
      inputs: [
        axis('vibration.x', [3, 0]),
        axis('vibration.y', [4, 0]),
        axis('vibration.z', [0, 5]),
      ],
    });

    expect(magnitude.samples[0]?.value).toBeCloseTo(5, 9);
    expect(magnitude.samples[1]?.value).toBeCloseTo(5, 9);
  });

  it('degrades when any axis is missing', () => {
    const partial = signalOf('vibration.z', [missing(0), valid(1, 5)], 'm/s^2');

    const magnitude = deriveSignal(registry, {
      id: 'vibration.magnitude',
      method: 'query:magnitude3',
      inputs: [axis('vibration.x', [3, 0]), axis('vibration.y', [4, 0]), partial],
    });

    expect(magnitude.samples[0]?.validity).toBe(Validity.MISSING);
    expect(magnitude.samples[0]?.value).toBeNaN();
  });

  it('requires exactly three inputs', () => {
    expect(() =>
      deriveSignal(registry, {
        id: 'x',
        method: 'query:magnitude3',
        inputs: [axis('a', [1]), axis('b', [1])],
      }),
    ).toThrow(QueryError);
  });
});

describe('query:rolling-rms', () => {
  const series = signalOf('attitude.roll.error', [
    valid(0, 3),
    valid(1, 4),
    valid(2, 0),
    valid(3, 0),
  ]);

  it('computes RMS over the trailing window', () => {
    const rms = deriveSignal(registry, {
      id: 'attitude.roll.error.rms',
      method: 'query:rolling-rms',
      inputs: [series],
      parameters: { windowSeconds: 1 },
    });

    // At t=1 the window [0,1] holds 3 and 4: sqrt((9+16)/2) = 3.5355...
    expect(rms.samples[1]?.value).toBeCloseTo(Math.sqrt(12.5), 9);
  });

  it('uses only the current sample when the window is shorter than the spacing', () => {
    const rms = deriveSignal(registry, {
      id: 'x',
      method: 'query:rolling-rms',
      inputs: [series],
      parameters: { windowSeconds: 0.5 },
    });

    expect(rms.samples[0]?.value).toBeCloseTo(3, 9);
    expect(rms.samples[1]?.value).toBeCloseTo(4, 9);
  });

  it('requires an explicit window, because the window is part of what the number means', () => {
    expect(() =>
      deriveSignal(registry, { id: 'x', method: 'query:rolling-rms', inputs: [series] }),
    ).toThrow(QueryError);
  });

  it('rejects a non-positive window', () => {
    expect(() =>
      deriveSignal(registry, {
        id: 'x',
        method: 'query:rolling-rms',
        inputs: [series],
        parameters: { windowSeconds: 0 },
      }),
    ).toThrow(QueryError);
  });

  it('produces NaN with a non-value-bearing validity where the window holds no usable data', () => {
    const empty = signalOf('a', [missing(0), missing(1)]);

    const rms = deriveSignal(registry, {
      id: 'x',
      method: 'query:rolling-rms',
      inputs: [empty],
      parameters: { windowSeconds: 5 },
    });

    for (const sample of rms.samples) {
      expect(Number.isNaN(sample.value)).toBe(true);
      expect(sample.validity).not.toBe(Validity.VALID);
    }
  });
});

describe('the registry', () => {
  it('ships the derivations phases D and E need', () => {
    expect(registry.definitions.map((definition) => definition.method).sort()).toEqual([
      'query:difference',
      'query:magnitude3',
      'query:rolling-rms',
    ]);
  });

  it('rejects an unknown method rather than silently doing nothing', () => {
    expect(() =>
      deriveSignal(registry, {
        id: 'x',
        method: 'query:fft',
        inputs: [signalOf('a', [valid(0, 1)])],
      }),
    ).toThrow(QueryError);
  });

  it('rejects two derivations sharing a method id', () => {
    const definition = registry.definitions[0];
    expect(definition).toBeDefined();
    if (definition !== undefined) {
      expect(() => registry.withDerivation(definition)).toThrow(QueryError);
    }
  });

  it('is immutable: withDerivation returns a new registry', () => {
    const extended = registry.withDerivation({
      method: 'query:test',
      version: '1.0.0',
      inputCount: 1,
      unitOf: () => 'unitless',
      compute: () => ({ values: new Float64Array(0), validity: new Uint8Array(0) }),
    });

    expect(registry.definitions).toHaveLength(3);
    expect(extended.definitions).toHaveLength(4);
  });

  it('requires inputs on a common grid, so alignment stays an explicit step', () => {
    expect(() =>
      deriveSignal(registry, {
        id: 'x',
        method: 'query:difference',
        inputs: [signalOf('a', [valid(0, 1), valid(1, 2)]), signalOf('b', [valid(0, 1)])],
      }),
    ).toThrow(QueryError);
  });
});
