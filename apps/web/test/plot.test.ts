/**
 * Plot geometry.
 *
 * The test that matters most here is the gap one. Filtering absent samples out and drawing a
 * continuous line through the hole is the natural implementation, and it draws a picture of data
 * that was never recorded — a GPS dropout rendered as a smooth glide. Doc 04 §1 rule 6 forbids
 * coercing absent data into a value; doing it in pixels is still doing it.
 */
import { describe, expect, it } from 'vitest';

import { createSignal, createTimeBase } from '@pandalog/core-domain';
import { Validity, type CanonicalUnit, type Sample } from '@pandalog/schema';

import { buildPlot, pointsAttribute, timeToX } from '../src/workspace/plot.js';

const timeBase = createTimeBase({ origin: 'BOOT' });

const signalOf = (samples: Sample[], unit: CanonicalUnit = 'm/s^2', id = 's') =>
  createSignal({ id, unit, sourceUnit: null, timeBase, samples });

const at = (t: number, value: number, validity: Validity = Validity.VALID): Sample => ({
  t_rel_seconds: t,
  value,
  validity,
});

const window = { startSeconds: 0, endSeconds: 4 };
const size = { width: 100, height: 50 };

describe('gaps break the line (doc 04 §1 rule 6)', () => {
  it('splits a run of MISSING samples into two segments', () => {
    const signal = signalOf([at(0, 1), at(1, 2), at(2, NaN, Validity.MISSING), at(3, 3), at(4, 4)]);

    const [series] = buildPlot([signal], window, size).series;

    expect(series?.segments).toHaveLength(2);
    expect(series?.gapCount).toBe(1);
  });

  it('never draws a point for a sample that was not measured', () => {
    const signal = signalOf([at(0, 1), at(2, NaN, Validity.MISSING), at(4, 3)]);

    const [series] = buildPlot([signal], window, size).series;
    const total = series?.segments.reduce((sum, segment) => sum + segment.length, 0);

    expect(total).toBe(2);
    expect(series?.pointCount).toBe(2);
  });

  it.each([[Validity.MISSING], [Validity.INVALID], [Validity.UNSUPPORTED]])(
    'treats %s as a break, not as a value',
    (validity) => {
      const signal = signalOf([at(0, 1), at(2, NaN, validity), at(4, 3)]);

      expect(buildPlot([signal], window, size).series[0]?.gapCount).toBe(1);
    },
  );

  it('draws through INTERPOLATED, which carries a real value (ADR-0007)', () => {
    const signal = signalOf([at(0, 1), at(2, 2, Validity.INTERPOLATED), at(4, 3)]);

    const [series] = buildPlot([signal], window, size).series;

    expect(series?.segments).toHaveLength(1);
    expect(series?.gapCount).toBe(0);
  });

  it('reports a signal with nothing usable as empty rather than drawing a flat line at zero', () => {
    const signal = signalOf([at(0, NaN, Validity.UNSUPPORTED), at(2, NaN, Validity.UNSUPPORTED)]);

    const [series] = buildPlot([signal], window, size).series;

    expect(series?.segments).toEqual([]);
    expect(series?.pointCount).toBe(0);
  });
});

describe('scaling', () => {
  it('maps the window across the full width', () => {
    const signal = signalOf([at(0, 1), at(4, 2)]);

    const points = buildPlot([signal], window, size).series[0]?.segments[0] ?? [];

    expect(points[0]?.x).toBeCloseTo(0, 6);
    expect(points[1]?.x).toBeCloseTo(100, 6);
  });

  it('puts the largest value at the top, since SVG y grows downward', () => {
    const signal = signalOf([at(0, 1), at(4, 5)]);

    const points = buildPlot([signal], window, size).series[0]?.segments[0] ?? [];

    expect(points[0]?.y).toBeCloseTo(50, 6);
    expect(points[1]?.y).toBeCloseTo(0, 6);
  });

  it('centres a flat series instead of dividing by a zero range', () => {
    const signal = signalOf([at(0, 3), at(4, 3)]);

    const [series] = buildPlot([signal], window, size).series;

    expect(series?.segments[0]?.[0]?.y).toBeCloseTo(25, 6);
    expect(Number.isFinite(series?.segments[0]?.[0]?.y ?? NaN)).toBe(true);
  });

  it('gives each signal its own vertical scale — different units share no axis', () => {
    const small = signalOf([at(0, 0), at(4, 1)], 'm/s^2', 'small');
    const large = signalOf([at(0, 0), at(4, 1000)], 'm/s^2', 'large');

    const { series } = buildPlot([small, large], window, size);

    expect(series[0]?.max).toBe(1);
    expect(series[1]?.max).toBe(1000);
  });

  it('survives a zero-width window without producing NaN coordinates', () => {
    const signal = signalOf([at(2, 1)]);

    const points =
      buildPlot([signal], { startSeconds: 2, endSeconds: 2 }, size).series[0]?.segments[0] ?? [];

    expect(Number.isFinite(points[0]?.x ?? NaN)).toBe(true);
  });
});

describe('display units', () => {
  it('labels an angle series in degrees and scales it there (doc 04 §1 rule 7)', () => {
    const signal = signalOf([at(0, 0), at(4, Math.PI)], 'rad', 'attitude.roll');

    const [series] = buildPlot([signal], window, size).series;

    expect(series?.unit).toBe('deg');
    expect(series?.max).toBeCloseTo(180, 6);
  });
});

describe('svg helpers', () => {
  it('formats a segment as an SVG points attribute', () => {
    expect(
      pointsAttribute([
        { x: 1.234, y: 5.678 },
        { x: 9, y: 10 },
      ]),
    ).toBe('1.23,5.68 9.00,10.00');
  });

  it('places an event marker on the same axis as the series', () => {
    expect(timeToX(2, window, 100)).toBeCloseTo(50, 6);
  });

  it('does not produce NaN for a marker on a zero-width window', () => {
    expect(timeToX(2, { startSeconds: 2, endSeconds: 2 }, 100)).toBe(0);
  });
});
