/**
 * Which charts describe a flight, and what to say when a log cannot support one.
 *
 * `chart.ts` lays a signal out; this decides *which* signals are worth laying out. Both the Summary
 * view and the HTML report ask that question and must get the same answer — a chart an engineer saw
 * on screen and cannot find in the document is a chart they will assume they misread.
 *
 * **An unavailable panel is shown, not hidden.** A log with no battery telemetry gets a battery
 * panel saying so. Dropping it would make "this aircraft logged no voltage" indistinguishable from
 * "this view does not show voltage", and the reader cannot tell which they are looking at — the
 * same reason `notApplicableRuleIds` is printed rather than filtered away (doc 03 §3).
 */
import type { ModeSegment } from '@pandalog/events';
import type { CanonicalFlightDataset, Signal } from '@pandalog/schema';

import { buildChart, type Chart, type ChartWindow } from './chart.js';

export interface ChartPanelDefinition {
  readonly id: string;
  readonly title: string;
  /** What the panel is for, shown so a chart is never just a shape. */
  readonly question: string;
  /** Signal ids in draw order. The first one present decides nothing — all present ones are drawn. */
  readonly signalIds: readonly string[];
  /** Ids that may stand in when the preferred ones are absent, e.g. GNSS altitude for barometric. */
  readonly fallbackSignalIds?: readonly string[];
}

/**
 * The panels, in the order an engineer scans a flight.
 *
 * Every id here exists in the ArduPilot catalogue (`packages/parser-ardupilot/src/catalog.ts`).
 * Nothing is listed speculatively: a panel for a signal no parser produces would be a permanently
 * empty box claiming the product measures something it does not.
 */
export const CHART_PANELS: readonly ChartPanelDefinition[] = Object.freeze([
  Object.freeze({
    id: 'altitude',
    title: 'Altitude',
    question: 'How high did it fly, and how steadily?',
    signalIds: Object.freeze(['baro.altitude']),
    fallbackSignalIds: Object.freeze(['gps.altitude']),
  }),
  Object.freeze({
    id: 'attitude-roll',
    title: 'Roll — actual against demanded',
    question: 'Did the aircraft go where it was told to, in roll?',
    signalIds: Object.freeze(['attitude.roll', 'attitude.roll.desired']),
  }),
  Object.freeze({
    id: 'attitude-pitch',
    title: 'Pitch — actual against demanded',
    question: 'Did the aircraft go where it was told to, in pitch?',
    signalIds: Object.freeze(['attitude.pitch', 'attitude.pitch.desired']),
  }),
  Object.freeze({
    id: 'vibration',
    title: 'Vibration',
    question: 'How much was the airframe shaking, on each axis?',
    signalIds: Object.freeze(['vibration.x', 'vibration.y', 'vibration.z']),
  }),
  Object.freeze({
    id: 'battery',
    title: 'Battery',
    question: 'How did the pack hold up under load?',
    signalIds: Object.freeze(['battery.voltage', 'battery.current']),
  }),
  Object.freeze({
    id: 'speed',
    title: 'Ground speed',
    question: 'How fast was it moving over the ground?',
    signalIds: Object.freeze(['gps.ground_speed']),
  }),
]);

export interface ChartPanel {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  /** Null when the log carries none of the panel's signals. */
  readonly chart: Chart | null;
  /** The signals actually drawn, in draw order. */
  readonly signalIds: readonly string[];
  /** Signals the panel wanted and the log does not carry — stated, not silently dropped. */
  readonly missingSignalIds: readonly string[];
  /** True when a fallback signal was drawn instead of the preferred one, so the axis can say so. */
  readonly usedFallback: boolean;
}

export interface FlightChartsOptions {
  readonly size: { readonly width: number; readonly height: number };
  /**
   * Convert to display units. On for a screen, off for a filed report — `format.ts` explains why a
   * report stays in canonical units, and a chart's axis labels are numbers like any other.
   */
  readonly displayUnits?: boolean;
}

function resolve(
  dataset: CanonicalFlightDataset,
  ids: readonly string[],
): { present: Signal[]; missing: string[] } {
  const present: Signal[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const signal = dataset.signals.get(id);
    if (signal === undefined) {
      missing.push(id);
    } else {
      present.push(signal);
    }
  }
  return { present, missing };
}

/**
 * Build every panel for a flight.
 *
 * `modes` is the workspace's single set of intervals, so the charts, the ground track, the 3D path
 * and the timeline agree about where a mode began and ended — including about which boundaries the
 * log never recorded (ADR-0016).
 */
export function flightCharts(
  dataset: CanonicalFlightDataset,
  modes: readonly ModeSegment[],
  window: ChartWindow,
  options: FlightChartsOptions,
): readonly ChartPanel[] {
  return CHART_PANELS.map((definition) => {
    const preferred = resolve(dataset, definition.signalIds);
    const useFallback =
      preferred.present.length === 0 && (definition.fallbackSignalIds?.length ?? 0) > 0;
    const chosen = useFallback ? resolve(dataset, definition.fallbackSignalIds ?? []) : preferred;

    if (chosen.present.length === 0) {
      return {
        id: definition.id,
        title: definition.title,
        question: definition.question,
        chart: null,
        signalIds: [],
        // When a fallback was tried too, report what was originally wanted: that is the signal an
        // engineer would go looking for in the log.
        missingSignalIds: definition.signalIds,
        usedFallback: false,
      };
    }

    return {
      id: definition.id,
      title: definition.title,
      question: definition.question,
      chart: buildChart({
        title: definition.title,
        signals: chosen.present,
        window,
        size: options.size,
        modes,
        displayUnits: options.displayUnits ?? false,
      }),
      signalIds: chosen.present.map((signal) => signal.id),
      missingSignalIds: chosen.missing,
      usedFallback: useFallback,
    };
  });
}
