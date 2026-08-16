/**
 * Resampling — 05_IMPLEMENTATION_ROADMAP.md Phase C acceptance, ADR-0007.
 *
 * The acceptance criterion is a property: resampling never breaks invariants 1a/1b. That is tested
 * below over many randomised signals and grids, alongside the specific behaviours the property
 * cannot pin down (which value, which validity, and where the boundaries fall).
 */
import { describe, expect, it } from 'vitest';

import { createSignal, createTimeBase } from '@pandalog/core-domain';
import { QueryError, resampleSignal, uniformGrid } from '@pandalog/query';
import { Validity, type Sample, type Signal } from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });

const signalOf = (samples: Sample[], id = 'test.signal'): Signal =>
  createSignal({ id, unit: 'm', sourceUnit: 'm', timeBase, samples });

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

/** Deterministic PRNG so a property failure is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('resampleSignal', () => {
  it('interpolates linearly between two valid samples', () => {
    const signal = signalOf([valid(0, 0), valid(1, 10)]);

    const resampled = resampleSignal(signal, { times: [0.25, 0.5], maxGapSeconds: 2 });

    expect(resampled.samples[0]?.value).toBeCloseTo(2.5, 9);
    expect(resampled.samples[1]?.value).toBeCloseTo(5, 9);
  });

  it('marks interpolated points INTERPOLATED with a finite value (ADR-0007)', () => {
    const signal = signalOf([valid(0, 0), valid(1, 10)]);

    const resampled = resampleSignal(signal, { times: [0.5], maxGapSeconds: 2 });

    expect(resampled.samples[0]?.validity).toBe(Validity.INTERPOLATED);
    expect(Number.isFinite(resampled.samples[0]?.value ?? NaN)).toBe(true);
  });

  it('keeps an exact hit on a measured sample VALID rather than calling it interpolated', () => {
    const signal = signalOf([valid(0, 0), valid(1, 10)]);

    const resampled = resampleSignal(signal, { times: [1], maxGapSeconds: 2 });

    expect(resampled.samples[0]?.validity).toBe(Validity.VALID);
    expect(resampled.samples[0]?.value).toBe(10);
  });

  it('yields MISSING with NaN across a gap wider than maxGapSeconds', () => {
    const signal = signalOf([valid(0, 0), valid(10, 100)]);

    const resampled = resampleSignal(signal, { times: [5], maxGapSeconds: 1 });

    expect(resampled.samples[0]?.validity).toBe(Validity.MISSING);
    expect(resampled.samples[0]?.value).toBeNaN();
  });

  it('interpolates across a gap exactly at the limit', () => {
    const signal = signalOf([valid(0, 0), valid(1, 100)]);

    const resampled = resampleSignal(signal, { times: [0.5], maxGapSeconds: 1 });

    expect(resampled.samples[0]?.validity).toBe(Validity.INTERPOLATED);
  });

  it('never extrapolates before the first sample', () => {
    const signal = signalOf([valid(1, 5), valid(2, 6)]);

    const resampled = resampleSignal(signal, { times: [0], maxGapSeconds: 10 });

    expect(resampled.samples[0]?.validity).toBe(Validity.MISSING);
    expect(resampled.samples[0]?.value).toBeNaN();
  });

  it('never extrapolates after the last sample', () => {
    const signal = signalOf([valid(1, 5), valid(2, 6)]);

    const resampled = resampleSignal(signal, { times: [3], maxGapSeconds: 10 });

    expect(resampled.samples[0]?.validity).toBe(Validity.MISSING);
  });

  it('does not interpolate through a MISSING sample as if it were data', () => {
    // The hole must stay a hole: interpolating 0 -> 100 straight through would invent a ramp.
    const signal = signalOf([valid(0, 0), missing(1), valid(2, 100)]);

    const resampled = resampleSignal(signal, { times: [1], maxGapSeconds: 1 });

    expect(resampled.samples[0]?.validity).toBe(Validity.MISSING);
  });

  it('interpolates across a MISSING sample when the surrounding support is close enough', () => {
    const signal = signalOf([valid(0, 0), missing(1), valid(2, 100)]);

    const resampled = resampleSignal(signal, { times: [1], maxGapSeconds: 5 });

    expect(resampled.samples[0]?.validity).toBe(Validity.INTERPOLATED);
    expect(resampled.samples[0]?.value).toBeCloseTo(50, 9);
  });

  it('records the derivation so the result is reproducible from the dataset (doc 02 §5)', () => {
    const resampled = resampleSignal(signalOf([valid(0, 0), valid(1, 1)]), {
      times: [0.5],
      maxGapSeconds: 2,
    });

    expect(resampled.derived).toBe(true);
    expect(resampled.derivation?.method).toBe('query:resample-linear');
    expect(resampled.derivation?.inputs).toEqual(['test.signal']);
  });

  it('yields all MISSING for an empty source signal rather than failing', () => {
    const resampled = resampleSignal(signalOf([]), { times: [0, 1], maxGapSeconds: 1 });

    expect(resampled.samples.map((sample) => sample.validity)).toEqual([
      Validity.MISSING,
      Validity.MISSING,
    ]);
  });

  describe('rejects an unusable grid', () => {
    it.each([
      ['non-monotonic', [1, 0]],
      ['duplicated', [0, 0]],
      ['non-finite', [0, NaN]],
      ['infinite', [0, Infinity]],
    ])('rejects a %s grid', (_label, times) => {
      expect(() => resampleSignal(signalOf([valid(0, 0)]), { times, maxGapSeconds: 1 })).toThrow(
        QueryError,
      );
    });
  });
});

describe('uniformGrid', () => {
  it('produces an inclusive grid at the requested rate', () => {
    expect(Array.from(uniformGrid(0, 1, 4))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('rejects a non-positive rate', () => {
    expect(() => uniformGrid(0, 1, 0)).toThrow(QueryError);
  });
});

// -------------------------------------------------------------------------------------------
// Phase C acceptance, as a property.
// -------------------------------------------------------------------------------------------
describe('property: resampling preserves invariants 1a/1b', () => {
  it('never emits a finite value with a non-value-bearing validity, or NaN with a value-bearing one', () => {
    const random = mulberry32(0xc0ffee);

    for (let trial = 0; trial < 300; trial += 1) {
      const sampleCount = 1 + Math.floor(random() * 12);
      const samples: Sample[] = [];
      let t = 0;

      for (let i = 0; i < sampleCount; i += 1) {
        t += random() * 2;
        const roll = random();
        if (roll < 0.25) {
          samples.push(missing(t));
        } else if (roll < 0.35) {
          samples.push({ t_rel_seconds: t, value: NaN, validity: Validity.UNSUPPORTED });
        } else if (roll < 0.45) {
          samples.push({
            t_rel_seconds: t,
            value: (random() - 0.5) * 1000,
            validity: Validity.INTERPOLATED,
          });
        } else {
          samples.push(valid(t, (random() - 0.5) * 1000));
        }
      }

      const grid: number[] = [];
      let gridTime = -1;
      for (let i = 0; i < 20; i += 1) {
        gridTime += random() * 1.5 + 1e-6;
        grid.push(gridTime);
      }

      const resampled = resampleSignal(signalOf(samples), {
        times: grid,
        maxGapSeconds: random() * 3,
      });

      for (const sample of resampled.samples) {
        const valueBearing =
          sample.validity === Validity.VALID || sample.validity === Validity.INTERPOLATED;

        if (valueBearing) {
          expect(Number.isFinite(sample.value), `trial ${String(trial)}: ${sample.validity}`).toBe(
            true,
          );
        } else {
          expect(Number.isNaN(sample.value), `trial ${String(trial)}: ${sample.validity}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('never produces a value outside the range of its supporting samples', () => {
    // Linear interpolation cannot overshoot; a value outside the bracket would mean the resampler
    // invented magnitude that the vehicle never recorded.
    const random = mulberry32(0x5eed);

    for (let trial = 0; trial < 200; trial += 1) {
      const samples: Sample[] = [];
      let t = 0;
      for (let i = 0; i < 10; i += 1) {
        t += 0.1 + random();
        samples.push(valid(t, (random() - 0.5) * 100));
      }

      const values = samples.map((sample) => sample.value);
      const min = Math.min(...values);
      const max = Math.max(...values);

      const resampled = resampleSignal(signalOf(samples), {
        times: uniformGrid(0, t, 3),
        maxGapSeconds: 5,
      });

      for (const sample of resampled.samples) {
        if (Number.isFinite(sample.value)) {
          expect(sample.value).toBeGreaterThanOrEqual(min - 1e-9);
          expect(sample.value).toBeLessThanOrEqual(max + 1e-9);
        }
      }
    }
  });
});
