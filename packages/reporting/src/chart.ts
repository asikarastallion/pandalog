/**
 * Chart geometry and static SVG — the shape of a signal, for a page rather than a screen.
 *
 * A report of 43 findings is prose about numbers. An engineer reads the shape of an altitude
 * profile faster than a paragraph describing it, and reads a mode band across a chart faster than a
 * table of mode changes. This module produces both.
 *
 * It lives in `@pandalog/reporting` rather than in `apps/web` for one structural reason: a package
 * may never import from the application (`dependency-layers.json` rule 3), so a chart the report
 * needs cannot live in the app. Putting it here and having the app reach it through the package it
 * already depends on is what keeps the chart in the document and the chart on the screen identical
 * — `apps/web/src/workspace/plot.ts` delegates its series building to `buildChartSeries` rather
 * than keeping a second copy of it.
 *
 * ## What it will not draw
 *
 * **A line is never drawn across missing data.** A run of samples that are not value-bearing —
 * `MISSING`, `INVALID`, `UNSUPPORTED` — breaks the stroke. Filtering them out and drawing through
 * the hole would render a GPS dropout as a smooth glide: doc 04 §1 rule 6 forbids coercing absent
 * data to a value, and joining across it is that, performed in pixels.
 *
 * **Series never share a vertical axis.** Signals in different units on one axis either mean
 * nothing or silently imply a conversion.
 *
 * **A mode band is drawn only where the log recorded one.** `modeSegments` marks the periods it
 * inferred, and an inferred band is drawn differently from a recorded one (ADR-0016).
 *
 * ## Units
 *
 * `toDisplayUnit` is applied when `displayUnits` is set, and `@pandalog/core-domain` owns the
 * conversion. The report leaves it off — `format.ts` explains why a filed document stays in
 * canonical units — and the app turns it on, because a screen is read and discarded.
 */
import { toDisplayUnit } from '@pandalog/core-domain';
import type { ModeSegment } from '@pandalog/events';
import { isValueBearing, type Signal } from '@pandalog/schema';

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ChartWindow {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

export interface ChartSeries {
  readonly signalId: string;
  /** The unit the values are in — canonical, or display when `displayUnits` was set. */
  readonly unit: string;
  /**
   * Contiguous runs of value-bearing samples. Two runs mean the data stopped and resumed; they are
   * never joined.
   */
  readonly segments: readonly (readonly ChartPoint[])[];
  readonly min: number;
  readonly max: number;
  /** Value-bearing sample count, so a caller can say "nothing to draw" from a fact. */
  readonly pointCount: number;
  /** Number of breaks — holes in the data over this window. */
  readonly gapCount: number;
}

/** Flat series render on the centre line rather than dividing by a zero range. */
const FLAT_SERIES_PADDING = 0.5;

export interface ChartSeriesOptions {
  /** Convert through `core-domain`'s table for readability. Off for a filed report. */
  readonly displayUnits?: boolean;
}

/** Where a time falls horizontally on a chart of this width. */
export function timeToX(seconds: number, window: ChartWindow, width: number): number {
  const span = window.endSeconds - window.startSeconds;
  return span === 0 ? 0 : ((seconds - window.startSeconds) / span) * width;
}

/** An SVG `points` attribute for one run. */
export const pointsAttribute = (segment: readonly ChartPoint[]): string =>
  segment.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

/** Lay one signal out over a window, breaking wherever the data is not value-bearing. */
export function buildChartSeries(
  signal: Signal,
  window: ChartWindow,
  size: ChartSize,
  options: ChartSeriesOptions = {},
): ChartSeries {
  const convert = options.displayUnits === true;
  const unit = convert ? toDisplayUnit(0, signal.unit).unit : signal.unit;

  const displayed = signal.samples.map((sample) => ({
    t: sample.t_rel_seconds,
    value:
      isValueBearing(sample.validity) && convert
        ? toDisplayUnit(sample.value, signal.unit).value
        : sample.value,
    usable: isValueBearing(sample.validity) && Number.isFinite(sample.value),
  }));

  const usableValues = displayed.filter((point) => point.usable).map((point) => point.value);
  let min = usableValues.length > 0 ? Math.min(...usableValues) : 0;
  let max = usableValues.length > 0 ? Math.max(...usableValues) : 0;
  if (min === max) {
    min -= FLAT_SERIES_PADDING;
    max += FLAT_SERIES_PADDING;
  }

  const toY = (value: number): number => size.height - ((value - min) / (max - min)) * size.height;

  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];

  for (const point of displayed) {
    if (!point.usable) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push({ x: timeToX(point.t, window, size.width), y: toY(point.value) });
  }
  if (current.length > 0) {
    segments.push(current);
  }

  return {
    signalId: signal.id,
    unit,
    segments,
    min,
    max,
    pointCount: usableValues.length,
    gapCount: Math.max(0, segments.length - 1),
  };
}

export interface ChartBand {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly x: number;
  readonly width: number;
  readonly mode: number | null;
  /** What to call it. A number until the vehicle is known — see ADR-0016. */
  readonly label: string;
  /** Index into a caller's palette. Stable per mode within one chart. */
  readonly colorIndex: number;
  /** True when either boundary was inferred rather than recorded. Drawn differently. */
  readonly inferred: boolean;
}

/** How many distinct colours a caller's palette must provide before bands start repeating. */
export const MODE_PALETTE_SIZE = 8;

/**
 * Place mode segments on a chart's horizontal axis.
 *
 * The colour index is assigned by order of first appearance so it is stable for one flight and
 * deterministic across runs — the same log always produces the same colouring, which a report that
 * must be reproducible requires.
 */
export function buildModeBands(
  segments: readonly ModeSegment[],
  window: ChartWindow,
  width: number,
): readonly ChartBand[] {
  const indexOfMode = new Map<number, number>();

  return segments.map((segment) => {
    if (segment.mode !== null && !indexOfMode.has(segment.mode)) {
      indexOfMode.set(segment.mode, indexOfMode.size % MODE_PALETTE_SIZE);
    }
    const x = timeToX(segment.startSeconds, window, width);
    const end = timeToX(segment.endSeconds, window, width);

    return {
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      x,
      width: Math.max(0, end - x),
      mode: segment.mode,
      label: segment.mode === null ? 'Mode not recorded' : `Mode ${String(segment.mode)}`,
      colorIndex: segment.mode === null ? -1 : (indexOfMode.get(segment.mode) ?? 0),
      inferred: !segment.startsAtLoggedChange || !segment.endsAtLoggedChange,
    };
  });
}

export interface Chart {
  readonly title: string;
  readonly size: ChartSize;
  readonly window: ChartWindow;
  readonly series: readonly ChartSeries[];
  readonly bands: readonly ChartBand[];
}

export interface BuildChartInput {
  readonly title: string;
  readonly signals: readonly Signal[];
  readonly window: ChartWindow;
  readonly size: ChartSize;
  readonly modes?: readonly ModeSegment[];
  readonly displayUnits?: boolean;
}

export function buildChart(input: BuildChartInput): Chart {
  return {
    title: input.title,
    size: input.size,
    window: input.window,
    series: input.signals.map((signal) =>
      buildChartSeries(signal, input.window, input.size, {
        ...(input.displayUnits === undefined ? {} : { displayUnits: input.displayUnits }),
      }),
    ),
    bands: buildModeBands(input.modes ?? [], input.window, input.size.width),
  };
}

/** Stroke colours, in the order series are given. Kept short: a chart needing ten lines is two charts. */
const SERIES_STROKES = Object.freeze([
  '#4a9eff',
  '#ff8f4a',
  '#5fd08a',
  '#d67cff',
  '#ffd24a',
  '#ff6b6b',
]);

/** Mode band fills, indexed by `ChartBand.colorIndex`. Low alpha: a band is context, not content. */
const MODE_FILLS = Object.freeze([
  '#4a9eff',
  '#ff8f4a',
  '#5fd08a',
  '#d67cff',
  '#ffd24a',
  '#ff6b6b',
  '#4adcd0',
  '#a0a8b8',
]);

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round = (value: number): string => value.toFixed(2);

/**
 * One chart as a standalone SVG element.
 *
 * Self-contained by construction — no external stylesheet, no font file, no script — because the
 * document it goes into has to survive being emailed, printed and filed.
 */
export function renderChartSvg(chart: Chart): string {
  const { width, height } = chart.size;
  const parts: string[] = [
    `<svg viewBox="0 0 ${String(width)} ${String(height)}" class="pl-chart" role="img" ` +
      `aria-label="${escapeXml(chart.title)}" preserveAspectRatio="none">`,
  ];

  for (const band of chart.bands) {
    if (band.width <= 0) {
      continue;
    }
    const fill = band.colorIndex < 0 ? '#8a8a8a' : (MODE_FILLS[band.colorIndex] ?? '#8a8a8a');
    // An inferred boundary is drawn hatched rather than solid: the log did not record it, and a
    // solid edge would present an inference as a transition (ADR-0016).
    parts.push(
      `<rect x="${round(band.x)}" y="0" width="${round(band.width)}" height="${String(height)}" ` +
        `fill="${fill}" fill-opacity="${band.inferred ? '0.06' : '0.14'}">` +
        `<title>${escapeXml(band.label)}${band.inferred ? ' (boundary not recorded)' : ''}</title>` +
        `</rect>`,
    );
  }

  for (const [index, series] of chart.series.entries()) {
    const stroke = SERIES_STROKES[index % SERIES_STROKES.length] ?? '#4a9eff';
    for (const [runIndex, run] of series.segments.entries()) {
      if (run.length === 1) {
        const point = run[0];
        if (point !== undefined) {
          parts.push(
            `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="1.5" fill="${stroke}"/>`,
          );
        }
        continue;
      }
      parts.push(
        `<polyline points="${pointsAttribute(run)}" fill="none" stroke="${stroke}" ` +
          `stroke-width="1.2" stroke-linejoin="round" data-run="${String(runIndex)}"/>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
