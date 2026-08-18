/**
 * The charts a Summary shows, and what to say when a log cannot support one.
 *
 * Summary previously answered "what did the analysis conclude" with four counts and a timeline. It
 * could not answer "what did the flight *do*", which is the question an engineer opens a log with,
 * and answering it in prose is answering it slowly — the shape of an altitude profile is read at a
 * glance and described in a paragraph.
 *
 * Geometry is `@pandalog/reporting`'s `buildChart`, which is also what the report draws with, so a
 * curve on screen and the same curve in the document are the same computation. What lives here is
 * the *selection*: which signals make a panel, and what a panel says when the log does not carry
 * them.
 *
 * **An unavailable panel is shown, not hidden.** A log with no battery telemetry gets a battery
 * panel saying so. Dropping it would make "this aircraft logged no voltage" indistinguishable from
 * "this view does not show voltage", and the reader cannot tell which they are looking at — the
 * same reason `notApplicableRuleIds` is printed rather than filtered away (doc 03 §3).
 */
import { modeSegments, type ModeSegment } from '@pandalog/events';
import { buildChart, type Chart } from '@pandalog/reporting';
import type { TimeWindow } from '@pandalog/query';
import type { CanonicalFlightDataset, Signal } from '@pandalog/schema';

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
 * Mode bands come from the same `modeSegments` the report and the ground track use, so all three
 * agree about where a mode began and ended — including about which boundaries the log never
 * recorded (ADR-0016).
 */
export function flightCharts(
  dataset: CanonicalFlightDataset,
  events: readonly {
    readonly type: string;
    readonly t_start_seconds: number;
    readonly id: string;
  }[],
  window: TimeWindow,
  options: FlightChartsOptions,
): readonly ChartPanel[] {
  const modes: readonly ModeSegment[] = modeSegments(
    events as Parameters<typeof modeSegments>[0],
    window,
  );

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
        // A screen is read and discarded, so it converts; a filed report does not (see
        // `packages/reporting/src/format.ts`).
        displayUnits: true,
      }),
      signalIds: chosen.present.map((signal) => signal.id),
      missingSignalIds: chosen.missing,
      usedFallback: useFallback,
    };
  });
}
