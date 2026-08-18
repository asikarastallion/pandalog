/**
 * Chart geometry, and the traceability guarantee that has to replace the numeric one.
 *
 * `no-calculation.test.ts` proves every *quantity* in the markdown traces back to the artifacts, by
 * mining the numbers out of the rendered text. That check cannot see a chart: an SVG is thousands
 * of coordinates, none of which is a measurement, and running the corpus scan over them would
 * either fail on a correct chart or have to ignore so much that it stopped meaning anything.
 *
 * So the guarantee is restated in the terms a chart can be held to:
 *
 *   1. **Every plotted point is a sample.** The count of plotted points equals the count of
 *      value-bearing samples — no interpolation, no smoothing, nothing added.
 *   2. **Absent data is absent.** A non-value-bearing run breaks the line rather than being drawn
 *      through, and the break count is reported.
 *   3. **A moved sample moves the chart.** A renderer that cached or recomputed geometry would keep
 *      drawing the old shape.
 *
 * Together those say the same thing the numeric check says: the picture contains what the data
 * contains and nothing else.
 */
import { createSignal } from '@pandalog/core-domain';
import { modeSegments } from '@pandalog/events';
import { createFlightEvent } from '@pandalog/events';
import { Validity, type Sample, type Signal } from '@pandalog/schema';
import { describe, expect, it } from 'vitest';

import { buildChart, buildChartSeries, buildModeBands, renderChartSvg } from '@pandalog/reporting';

import { runFixture } from './support/artifacts.js';

const SIZE = { width: 600, height: 120 };
const WINDOW = { startSeconds: 0, endSeconds: 10 };

const sample = (t: number, value: number, validity: Validity = Validity.VALID): Sample => ({
  t_rel_seconds: t,
  value,
  validity,
});

/**
 * A sample the log did not record.
 *
 * The value is NaN because the canonical model refuses any other choice: a non-value-bearing sample
 * carrying a finite number is rejected at construction (doc 02 §3 invariant 1b, ADR-0007). Writing
 * this helper as `absent(2)` rather than `sample(2, 0, MISSING)` keeps that fact visible in the
 * tests instead of leaving a zero sitting where a reader could mistake it for a reading.
 */
const absent = (t: number, validity: Validity = Validity.MISSING): Sample => ({
  t_rel_seconds: t,
  value: Number.NaN,
  validity,
});

const signalOf = (samples: readonly Sample[]): Signal =>
  createSignal({
    id: 'test.signal',
    unit: 'm',
    sourceUnit: null,
    timeBase: {
      origin: 'BOOT',
      epochUtc: null,
      syncUncertaintySeconds: null,
      uniformlySampled: false,
    },
    samples,
  });

describe('every plotted point is a sample', () => {
  it('plots exactly the value-bearing samples, adding none', () => {
    const samples = [sample(0, 1), sample(2, 5), sample(4, 3), sample(6, 9)];
    const series = buildChartSeries(signalOf(samples), WINDOW, SIZE);

    expect(series.pointCount).toBe(4);
    expect(series.segments.flat()).toHaveLength(4);
  });

  it('reports a range taken from the samples, not padded to a round number', () => {
    const series = buildChartSeries(signalOf([sample(0, 1.7), sample(5, 8.3)]), WINDOW, SIZE);

    expect(series.min).toBe(1.7);
    expect(series.max).toBe(8.3);
  });

  it('keeps a flat series on the chart instead of dividing by a zero range', () => {
    const series = buildChartSeries(signalOf([sample(0, 4), sample(5, 4)]), WINDOW, SIZE);

    expect(series.min).toBeLessThan(series.max);
    for (const point of series.segments.flat()) {
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(SIZE.height);
    }
  });
});

describe('absent data is absent', () => {
  it('breaks the line across a run that was not recorded', () => {
    // Drawing through this would render the dropout as a smooth glide (doc 04 §1 rule 6).
    const series = buildChartSeries(
      signalOf([sample(0, 1), sample(1, 2), absent(2), absent(3), sample(4, 3)]),
      WINDOW,
      SIZE,
    );

    expect(series.segments).toHaveLength(2);
    expect(series.gapCount).toBe(1);
    expect(series.pointCount).toBe(3);
  });

  it('breaks for every non-value-bearing validity, not only MISSING', () => {
    for (const validity of [Validity.MISSING, Validity.INVALID, Validity.UNSUPPORTED]) {
      const series = buildChartSeries(
        signalOf([sample(0, 1), absent(1, validity), sample(2, 3)]),
        WINDOW,
        SIZE,
      );

      expect(series.gapCount, `${validity} did not break the line`).toBe(1);
    }
  });

  it('draws nothing, and says so, for a signal with no usable sample', () => {
    const series = buildChartSeries(
      signalOf([absent(0), absent(1, Validity.INVALID)]),
      WINDOW,
      SIZE,
    );

    expect(series.segments).toEqual([]);
    expect(series.pointCount).toBe(0);
  });

  it('emits no polyline across a break in the SVG either', () => {
    const chart = buildChart({
      title: 'test',
      signals: [signalOf([sample(0, 1), absent(1), sample(2, 3)])],
      window: WINDOW,
      size: SIZE,
    });
    const svg = renderChartSvg(chart);

    // Two runs of one point each — drawn as points, never joined into one stroke.
    expect(svg).not.toContain('<polyline');
    expect(svg.match(/<circle/g)).toHaveLength(2);
  });
});

describe('a sample that moves', () => {
  it('moves the chart with it', () => {
    const before = renderChartSvg(
      buildChart({
        title: 'test',
        signals: [signalOf([sample(0, 1), sample(2, 5), sample(4, 3)])],
        window: WINDOW,
        size: SIZE,
      }),
    );
    const after = renderChartSvg(
      buildChart({
        title: 'test',
        signals: [signalOf([sample(0, 1), sample(2, 5), sample(4, 3.5)])],
        window: WINDOW,
        size: SIZE,
      }),
    );

    expect(after).not.toBe(before);
  });

  it('produces identical output for identical input, so a report stays reproducible', () => {
    const build = (): string =>
      renderChartSvg(
        buildChart({
          title: 'test',
          signals: [signalOf([sample(0, 1), sample(2, 5)])],
          window: WINDOW,
          size: SIZE,
        }),
      );

    expect(build()).toBe(build());
  });
});

describe('mode bands', () => {
  const change = (t: number, mode: number) =>
    createFlightEvent({
      id: `event:mode-change:${String(t)}`,
      type: 'mode-change',
      t_start_seconds: t,
      detector: { name: 'events:mode-change', version: '1.0.0' },
      payload: { Mode: mode },
    });

  it('spans the chart without gaps between consecutive modes', () => {
    const bands = buildModeBands(
      modeSegments([change(0, 5), change(5, 6)], WINDOW),
      WINDOW,
      SIZE.width,
    );

    expect(bands).toHaveLength(2);
    expect(bands[0]?.x).toBe(0);
    expect((bands[0]?.x ?? 0) + (bands[0]?.width ?? 0)).toBeCloseTo(bands[1]?.x ?? 0, 6);
    expect((bands[1]?.x ?? 0) + (bands[1]?.width ?? 0)).toBeCloseTo(SIZE.width, 6);
  });

  it('gives one mode one colour however often it recurs', () => {
    const bands = buildModeBands(
      modeSegments([change(0, 5), change(3, 6), change(6, 5)], WINDOW),
      WINDOW,
      SIZE.width,
    );

    expect(bands.map((band) => band.colorIndex)).toEqual([0, 1, 0]);
  });

  it('labels a mode by its number, because the name depends on the airframe', () => {
    // ArduCopter 5 is LOITER, ArduPlane 5 is FBWA, and frameClass is often not logged (ADR-0016).
    const [band] = buildModeBands(modeSegments([change(0, 5)], WINDOW), WINDOW, SIZE.width);

    expect(band?.label).toBe('Mode 5');
  });

  it('marks an inferred boundary and draws it more faintly than a recorded one', () => {
    const bands = buildModeBands(
      modeSegments([change(2, 5), change(5, 6)], WINDOW),
      WINDOW,
      SIZE.width,
    );
    const [leading, recorded] = bands;

    expect(leading?.mode).toBeNull();
    expect(leading?.label).toBe('Mode not recorded');
    expect(leading?.inferred).toBe(true);
    // The middle band is bounded by two logged changes, so nothing about it is inferred.
    expect(recorded?.inferred).toBe(false);

    const svg = renderChartSvg({
      title: 'test',
      size: SIZE,
      window: WINDOW,
      series: [],
      bands,
    });
    expect(svg).toContain('fill-opacity="0.06"');
    expect(svg).toContain('fill-opacity="0.14"');
    expect(svg).toContain('(boundary not recorded)');
  });
});

describe('the SVG is self-contained', () => {
  it('references no external stylesheet, font, script or image', async () => {
    const result = await runFixture('degraded-flight.bin');
    const altitude = result.dataset.signals.get('gps.altitude');
    if (altitude === undefined) {
      throw new Error('The fixture no longer carries gps.altitude.');
    }

    const svg = renderChartSvg(
      buildChart({
        title: 'Altitude',
        signals: [altitude],
        window: { startSeconds: 0, endSeconds: 10 },
        size: SIZE,
        modes: modeSegments(result.events, { startSeconds: 0, endSeconds: 10 }),
      }),
    );

    // A report is emailed, printed and filed. Anything it has to fetch is something it can lose.
    for (const forbidden of ['<script', 'http://', 'https://', '<image', '@import', 'url(']) {
      expect(svg, `chart SVG contains ${forbidden}`).not.toContain(forbidden);
    }
    expect(svg).toContain('<polyline');
  });

  it('escapes a title rather than letting it close the element', () => {
    const svg = renderChartSvg({
      title: 'a"b<c>&d',
      size: SIZE,
      window: WINDOW,
      series: [],
      bands: [],
    });

    expect(svg).toContain('aria-label="a&quot;b&lt;c&gt;&amp;d"');
  });
});
