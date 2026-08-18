/**
 * Plot geometry for the app.
 *
 * The geometry itself is `@pandalog/reporting`'s (`chart.ts`) and this is a thin adapter over it.
 * That is deliberate: the report has to draw the same signals, a package may never import from
 * `apps/web` (`dependency-layers.json` rule 3), and two implementations of "where does this sample
 * go" would be two chances for the picture in the document and the picture on the screen to
 * disagree about the same flight.
 *
 * What survives here is the app's own decision — **display units**. `format.ts` in reporting
 * explains why a filed report stays in canonical units; a screen is read and discarded, so the app
 * converts. That is the one axis on which the two renderings differ, and it is a choice rather than
 * a drift.
 *
 * The property worth restating, because it is the one that matters and it now lives one package
 * away: a run of samples that are not value-bearing — `MISSING`, `INVALID`, `UNSUPPORTED` —
 * **breaks the line**. Drawing through the hole would render a GPS dropout as a smooth glide, which
 * is doc 04 §1 rule 6 violated in pixels instead of in numbers.
 */
import { buildChartSeries, pointsAttribute, timeToX } from '@pandalog/reporting';
import type { ChartPoint, ChartSeries } from '@pandalog/reporting';
import type { TimeWindow } from '@pandalog/query';
import type { Signal } from '@pandalog/schema';

export type PlotPoint = ChartPoint;
export type PlotSeries = ChartSeries;

export interface PlotSize {
  readonly width: number;
  readonly height: number;
}

export interface Plot {
  readonly size: PlotSize;
  readonly window: TimeWindow;
  readonly series: readonly PlotSeries[];
}

export function buildPlot(signals: readonly Signal[], window: TimeWindow, size: PlotSize): Plot {
  return {
    size,
    window,
    series: signals.map((signal) => buildChartSeries(signal, window, size, { displayUnits: true })),
  };
}

export { pointsAttribute, timeToX };
