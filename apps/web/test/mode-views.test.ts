// @vitest-environment happy-dom
/**
 * Mode colouring reaching the three views that draw a flight.
 *
 * `mode-track.test.ts` proves the split; this proves the wiring, and one property that only shows
 * up once all three are rendered: **the same mode is the same colour everywhere.** A mode that is
 * blue on the chart and orange on the map is worse than no colour at all, because a reader
 * comparing the two concludes they are looking at different things.
 *
 * No committed fixture carries both. `mode-change-error.bin` changes mode and logs no position;
 * `degraded-flight.bin` logs position and never leaves one mode. So each is used for what it can
 * actually prove: the timeline runs against real mode changes, and the map and 3D view run against
 * a real flown path with **constructed** mode changes over its own window. That construction is
 * stated rather than hidden — the split is what is under test here, and `segments.test.ts` already
 * holds the derivation of the intervals themselves.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlightEvent, modeSegments } from '@pandalog/events';
import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';

import EventTimeline from '../src/components/EventTimeline.vue';
import GroundTrackMap from '../src/components/GroundTrackMap.vue';
import PlaybackView from '../src/views/PlaybackView.vue';
import { buildGroundTrack } from '../src/workspace/track.js';
import { buildTrajectory } from '../src/workspace/trajectory.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const load = (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

/** The log that changes mode. No position, so it drives the timeline only. */
let changing: PipelineResult;
/** The log that flew somewhere. One mode, so its mode changes are constructed below. */
let flown: PipelineResult;

const TIMELINE_WINDOW = { startSeconds: 0, endSeconds: 5 };
const FLIGHT_WINDOW = { startSeconds: 0, endSeconds: 8 };

let timelineModes: ReturnType<typeof modeSegments>;
let flightModes: ReturnType<typeof modeSegments>;

beforeAll(async () => {
  [changing, flown] = await Promise.all([
    load('mode-change-error.bin'),
    load('degraded-flight.bin'),
  ]);

  timelineModes = modeSegments(changing.events, TIMELINE_WINDOW);
  flightModes = modeSegments(
    [
      createFlightEvent({
        id: 'event:mode-change:0',
        type: 'mode-change',
        t_start_seconds: 0,
        detector: { name: 'events:mode-change', version: '1.0.0' },
        payload: { Mode: 5 },
      }),
      createFlightEvent({
        id: 'event:mode-change:4',
        type: 'mode-change',
        t_start_seconds: 4,
        detector: { name: 'events:mode-change', version: '1.0.0' },
        payload: { Mode: 6 },
      }),
    ],
    FLIGHT_WINDOW,
  );
});

describe('the inputs can show what is being tested', () => {
  it('gives the timeline a log that really changes mode', () => {
    expect(new Set(timelineModes.map((segment) => segment.mode)).size).toBeGreaterThan(1);
  });

  it('gives the map a log that really flew somewhere', () => {
    expect(buildGroundTrack(flown.dataset).pointCount).toBeGreaterThan(1);
  });
});

describe('the ground track', () => {
  const mountMap = () =>
    mount(GroundTrackMap, {
      props: { track: buildGroundTrack(flown.dataset), playback: null, modes: flightModes },
    });

  it('draws a coloured polyline per mode piece rather than one for the whole path', () => {
    const wrapper = mountMap();
    const lines = wrapper.findAll('polyline');

    expect(lines.length).toBeGreaterThan(1);
    const strokes = new Set(lines.map((line) => line.attributes('stroke')));
    expect(strokes.size).toBeGreaterThan(1);
  });

  it('shows a legend naming each mode by its number', () => {
    // Never "LOITER": 5 is LOITER on a copter and FBWA on a plane, and this log does not say which.
    expect(mountMap().text()).toMatch(/Mode \d/);
    expect(mountMap().text()).not.toContain('LOITER');
  });

  it('dashes a stretch the log stated no mode for instead of colouring it', () => {
    const wrapper = mountMap();
    const unrecorded = wrapper.findAll('polyline.unrecorded');
    const hasUnrecorded = flightModes.some((segment) => segment.mode === null);

    expect(unrecorded.length > 0).toBe(hasUnrecorded);
  });
});

describe('the 3D playback', () => {
  it('colours the flown path by mode too', () => {
    const track = buildGroundTrack(flown.dataset);
    const wrapper = mount(PlaybackView, {
      props: {
        trajectory: buildTrajectory(flown.dataset, track),
        playback: null,
        modes: flightModes,
      },
    });

    const strokes = new Set(wrapper.findAll('line.path').map((line) => line.attributes('stroke')));

    expect(wrapper.findAll('line.path').length).toBeGreaterThan(0);
    expect(strokes.size).toBeGreaterThan(1);
    expect(wrapper.text()).toMatch(/Mode \d/);
  });
});

describe('the timeline', () => {
  const modeTitles = (wrapper: ReturnType<typeof mount>): string[] =>
    wrapper
      .findAll('rect title')
      .map((title) => title.text())
      .filter((text) => text.startsWith('Mode'));

  const mountTimeline = () =>
    mount(EventTimeline, {
      props: {
        events: changing.events,
        window: TIMELINE_WINDOW,
        highlight: null,
        modes: timelineModes,
      },
    });

  it('draws a mode strip, one rectangle per interval', () => {
    expect(modeTitles(mountTimeline())).toHaveLength(timelineModes.length);
  });

  it('names each interval with its mode and its extent', () => {
    expect(modeTitles(mountTimeline())[0]).toMatch(/^Mode .+ — .+ to .+$/);
  });

  it('draws no strip at all when no mode information was passed', () => {
    const wrapper = mount(EventTimeline, {
      props: { events: changing.events, window: TIMELINE_WINDOW, highlight: null },
    });

    expect(modeTitles(wrapper)).toHaveLength(0);
  });
});

describe('one colour per mode, across every view', () => {
  it('agrees between the map, the 3D path, the timeline and the charts', async () => {
    const { buildModeBands, flightCharts, modeFill } = await import('@pandalog/reporting');


    // The charts' assignment is the reference — every view derives from assignModeColors.
    const chartColours = new Map(
      buildModeBands(flightModes, FLIGHT_WINDOW, 100).map((band) => [
        band.label,
        modeFill(band.colorIndex),
      ]),
    );
    expect(chartColours.size).toBeGreaterThan(1);

    const panelBands =
      flightCharts(flown.dataset, flightModes, FLIGHT_WINDOW, {
        size: { width: 100, height: 10 },
      }).find((panel) => panel.chart !== null)?.chart?.bands ?? [];
    for (const band of panelBands) {
      expect(modeFill(band.colorIndex)).toBe(chartColours.get(band.label));
    }

    const mapStrokes = mount(GroundTrackMap, {
      props: { track: buildGroundTrack(flown.dataset), playback: null, modes: flightModes },
    })
      .findAll('polyline')
      .map((line) => ({
        stroke: line.attributes('stroke'),
        label: line.find('title').text(),
      }));

    for (const line of mapStrokes) {
      const expected = chartColours.get(line.label);
      if (expected === undefined || line.label === 'Mode not recorded') {
        continue;
      }
      expect(line.stroke, `${line.label} is a different colour on the map`).toBe(expected);
    }
  });
});
