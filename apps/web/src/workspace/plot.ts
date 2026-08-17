/**
 * Plot geometry.
 *
 * This is arithmetic, so it lives outside the component (doc 04 §1 rule 1). `SignalPlot.vue` gets
 * finished coordinates and renders them; it computes nothing, which is what lets the plot's
 * behaviour be tested without mounting anything.
 *
 * The property worth naming is the gap handling. A run of samples that are not value-bearing —
 * `MISSING`, `INVALID`, `UNSUPPORTED` — **breaks the line**. It would be easy to filter those out
 * and draw a continuous stroke through the hole, and the result would be a picture of data that was
 * never recorded: a GPS dropout would look like a smooth glide. Doc 04 §1 rule 6 forbids coercing
 * absent data into a value, and drawing a line across it is exactly that, performed in pixels
 * instead of numbers.
 *
 * Each series carries its own vertical scale. Signals in different units share no axis, because a
 * shared one would either be meaningless or would silently imply a conversion.
 */
import { toDisplayUnit } from '@pandalog/core-domain';
import type { TimeWindow } from '@pandalog/query';
import { isValueBearing, type Signal } from '@pandalog/schema';

export interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

export interface PlotSeries {
  readonly signalId: string;
  /** Display unit, from `core-domain` — never computed here. */
  readonly unit: string;
  /**
   * Contiguous runs of value-bearing samples. Two segments mean the data stopped and resumed;
   * they are never joined.
   */
  readonly segments: readonly (readonly PlotPoint[])[];
  /** Range in display units, for the axis labels. */
  readonly min: number;
  readonly max: number;
  /** Value-bearing sample count, so a component can say "nothing to draw" honestly. */
  readonly pointCount: number;
  /** Number of breaks — the count of holes in the data over this window. */
  readonly gapCount: number;
}

export interface PlotSize {
  readonly width: number;
  readonly height: number;
}

export interface Plot {
  readonly size: PlotSize;
  readonly window: TimeWindow;
  readonly series: readonly PlotSeries[];
}

/** Flat series render on the centre line rather than dividing by a zero range. */
const FLAT_SERIES_PADDING = 0.5;

function buildSeries(signal: Signal, window: TimeWindow, size: PlotSize): PlotSeries {
  const unit = toDisplayUnit(0, signal.unit).unit;

  const displayed: { t: number; value: number; usable: boolean }[] = signal.samples.map(
    (sample) => ({
      t: sample.t_rel_seconds,
      value: isValueBearing(sample.validity) ? toDisplayUnit(sample.value, signal.unit).value : NaN,
      usable: isValueBearing(sample.validity) && Number.isFinite(sample.value),
    }),
  );

  const usableValues = displayed.filter((point) => point.usable).map((point) => point.value);
  let min = usableValues.length > 0 ? Math.min(...usableValues) : 0;
  let max = usableValues.length > 0 ? Math.max(...usableValues) : 0;
  if (min === max) {
    min -= FLAT_SERIES_PADDING;
    max += FLAT_SERIES_PADDING;
  }

  const span = window.endSeconds - window.startSeconds;
  const toX = (t: number): number =>
    span === 0 ? 0 : ((t - window.startSeconds) / span) * size.width;
  const toY = (value: number): number => size.height - ((value - min) / (max - min)) * size.height;

  const segments: PlotPoint[][] = [];
  let current: PlotPoint[] = [];

  for (const point of displayed) {
    if (!point.usable) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push({ x: toX(point.t), y: toY(point.value) });
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

export function buildPlot(signals: readonly Signal[], window: TimeWindow, size: PlotSize): Plot {
  return {
    size,
    window,
    series: signals.map((signal) => buildSeries(signal, window, size)),
  };
}

/** An SVG `points` attribute for one segment. */
export const pointsAttribute = (segment: readonly PlotPoint[]): string =>
  segment.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

/** Where a time falls horizontally, for drawing an event marker on the same axis. */
export function timeToX(seconds: number, window: TimeWindow, width: number): number {
  const span = window.endSeconds - window.startSeconds;
  return span === 0 ? 0 : ((seconds - window.startSeconds) / span) * width;
}
