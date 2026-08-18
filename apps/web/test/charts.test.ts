// @vitest-environment happy-dom
/**
 * Which charts a Summary shows, and what it says when a log cannot support one.
 *
 * The selection is the part worth testing without a browser. Geometry belongs to
 * `@pandalog/reporting` and is tested there; what happens here is a decision about what a log can
 * and cannot be asked to show, and the interesting half of that is the "cannot": a panel that
 * quietly disappears when its signal is missing makes "this aircraft logged no voltage"
 * indistinguishable from "this view does not show voltage".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mount } from '@vue/test-utils';
import { modeSegments } from '@pandalog/events';
import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';

import FlightCharts from '../src/components/FlightCharts.vue';
import SummaryView from '../src/views/SummaryView.vue';
import { CHART_PANELS, flightCharts } from '../src/workspace/charts.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const SIZE = { width: 600, height: 110 };

const load = (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

let result: PipelineResult;
const WINDOW = { startSeconds: 0, endSeconds: 8 };

beforeAll(async () => {
  result = await load('degraded-flight.bin');
});

const modes = () => modeSegments(result.events, WINDOW);
const panels = () => flightCharts(result.dataset, modes(), WINDOW, { size: SIZE });

describe('the panels a flight produces', () => {
  it('returns one panel per definition, present or not', () => {
    expect(panels()).toHaveLength(CHART_PANELS.length);
  });

  it('draws attitude against its demand, both series on one panel', () => {
    const roll = panels().find((panel) => panel.id === 'attitude-roll');

    expect(roll?.signalIds).toEqual(['attitude.roll', 'attitude.roll.desired']);
    expect(roll?.chart?.series).toHaveLength(2);
  });

  it('draws all three vibration axes', () => {
    const vibration = panels().find((panel) => panel.id === 'vibration');

    expect(vibration?.signalIds).toEqual(['vibration.x', 'vibration.y', 'vibration.z']);
  });

  it('plots only what the signals contain', () => {
    const speed = panels().find((panel) => panel.id === 'speed');
    const signal = result.dataset.signals.get('gps.ground_speed');
    const valueBearing = signal?.samples.filter((sample) => Number.isFinite(sample.value)).length;

    expect(speed?.chart?.series[0]?.pointCount).toBe(valueBearing);
  });
});

describe('a signal the log does not carry', () => {
  it('leaves the panel in place and names what is missing', () => {
    // degraded-flight.bin carries no battery telemetry. The panel must still appear.
    const battery = panels().find((panel) => panel.id === 'battery');

    expect(battery).toBeDefined();
    expect(battery?.chart).toBeNull();
    expect(battery?.missingSignalIds).toEqual(['battery.voltage', 'battery.current']);
  });

  it('falls back to GNSS altitude when the barometer is absent, and says it did', () => {
    const altitude = panels().find((panel) => panel.id === 'altitude');

    expect(altitude?.chart).not.toBeNull();
    expect(altitude?.signalIds).toEqual(['gps.altitude']);
    expect(altitude?.usedFallback).toBe(true);
  });

  it('names the preferred signal, not the fallback, when neither is present', () => {
    const empty = { ...result.dataset, signals: new Map() };
    const altitude = flightCharts(empty, [], WINDOW, { size: SIZE }).find(
      (panel) => panel.id === 'altitude',
    );

    // "baro.altitude is missing" is what an engineer would go looking for in the log.
    expect(altitude?.missingSignalIds).toEqual(['baro.altitude']);
    expect(altitude?.usedFallback).toBe(false);
  });

  it('reports a partially available panel as drawn, listing the absent series', () => {
    const partial = new Map(result.dataset.signals);
    partial.delete('attitude.roll.desired');
    const roll = flightCharts({ ...result.dataset, signals: partial }, [], WINDOW, {
      size: SIZE,
    }).find((panel) => panel.id === 'attitude-roll');

    expect(roll?.signalIds).toEqual(['attitude.roll']);
    expect(roll?.missingSignalIds).toEqual(['attitude.roll.desired']);
    expect(roll?.chart?.series).toHaveLength(1);
  });
});

describe('mode bands', () => {
  it('bands every panel identically, from the flight’s own mode changes', () => {
    const drawn = panels().filter((panel) => panel.chart !== null);
    const first = drawn[0]?.chart?.bands;

    expect(drawn.length).toBeGreaterThan(1);
    for (const panel of drawn) {
      expect(panel.chart?.bands).toEqual(first);
    }
  });

  it('bands from the same segments the report and the ground track use', () => {
    const bands = panels().find((panel) => panel.chart !== null)?.chart?.bands ?? [];

    expect(bands.map((band) => [band.startSeconds, band.endSeconds])).toEqual(
      modeSegments(result.events, WINDOW).map((s) => [s.startSeconds, s.endSeconds]),
    );
  });
});

describe('every panel names a signal a parser actually produces', () => {
  it('lists no speculative signal id', () => {
    // A panel for a signal nothing produces is a permanently empty box claiming the product
    // measures something it does not. The check reads the parser's catalogue as text rather than
    // importing it — a component may not reach a parser (doc 04 §1 rule 2), and hand-maintaining an
    // allowlist here would be a second copy of the catalogue, drifting quietly.
    const catalogue = readFileSync(
      path.resolve(FIXTURES, '..', '..', 'packages', 'parser-ardupilot', 'src', 'catalog.ts'),
      'utf8',
    );
    const produced = new Set(
      [...catalogue.matchAll(/id: '([a-z0-9_.]+)'/g)].map((match) => match[1]),
    );

    expect(produced.size).toBeGreaterThan(10);

    for (const panel of CHART_PANELS) {
      for (const id of [...panel.signalIds, ...(panel.fallbackSignalIds ?? [])]) {
        expect(produced.has(id), `${id} is not in the ArduPilot signal catalogue`).toBe(true);
      }
    }
  });
});

describe('the charts reach the screen', () => {
  const mountCharts = () =>
    mount(FlightCharts, {
      props: { panels: panels(), window: WINDOW, size: SIZE },
    });

  it('draws one polyline per contiguous run, never one per series', () => {
    // If a break were drawn through, a series with a gap would emit one polyline instead of two —
    // which is the GPS dropout rendered as a smooth glide (doc 04 §1 rule 6).
    const wrapper = mountCharts();
    const runs = panels()
      .flatMap((panel) => panel.chart?.series ?? [])
      .reduce((total, series) => total + series.segments.filter((run) => run.length > 1).length, 0);

    expect(runs).toBeGreaterThan(0);
    expect(wrapper.findAll('polyline')).toHaveLength(runs);
  });

  it('names a break rather than leaving it to look like a rendering artefact', () => {
    const withGap = panels().find((panel) =>
      (panel.chart?.series ?? []).some((series) => series.gapCount > 0),
    );
    if (withGap === undefined) {
      // degraded-flight.bin loses its GNSS fix, so this should not happen; failing loudly beats
      // silently skipping the assertion this test exists for.
      throw new Error('The fixture no longer produces a signal with a gap.');
    }

    expect(mountCharts().text()).toContain('not recorded');
  });

  it('lists a panel it cannot draw instead of dropping it', () => {
    const text = mountCharts().text();

    expect(text).toContain('Battery');
    expect(text).toContain('battery.voltage');
  });

  it('appears on the Summary view itself', () => {
    const wrapper = mount(SummaryView, {
      props: { result, flightWindow: WINDOW, modes: modes() },
    });

    expect(wrapper.findComponent(FlightCharts).exists()).toBe(true);
    expect(wrapper.findAll('polyline').length).toBeGreaterThan(0);
  });

  it('renders nothing rather than an empty frame when the flight has no extent', () => {
    const wrapper = mount(SummaryView, {
      props: { result, flightWindow: null, modes: [] },
    });

    expect(wrapper.findComponent(FlightCharts).exists()).toBe(false);
  });
});
