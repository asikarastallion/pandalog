/**
 * Cutting a flown path by flight mode.
 *
 * The colouring is what the eye reads first on a map, which makes a wrong cut worse than a missing
 * one: an engineer who sees a leg coloured LOITER concludes the aircraft was loitering there. So
 * the tests are mostly about what the split refuses to do — join across a gap the log left, invent
 * a position at the instant of the change, or colour a stretch the log stated no mode for.
 */
import { createFlightEvent, modeSegments, type FlightEvent } from '@pandalog/events';
import { describe, expect, it } from 'vitest';

import { modeLegend, splitByMode } from '../src/workspace/mode-track.js';

const WINDOW = { startSeconds: 0, endSeconds: 100 };

const change = (t: number, mode: number): FlightEvent =>
  createFlightEvent({
    id: `event:mode-change:${String(t)}`,
    type: 'mode-change',
    t_start_seconds: t,
    detector: { name: 'events:mode-change', version: '1.0.0' },
    payload: { Mode: mode },
  });

const at = (tSeconds: number) => ({ tSeconds, eastMeters: tSeconds, northMeters: 0 });
const run = (...times: number[]) => times.map(at);

describe('cutting a run where the mode changed', () => {
  it('splits one run into one piece per mode', () => {
    const segments = modeSegments([change(0, 5), change(50, 6)], WINDOW);
    const pieces = splitByMode([run(0, 10, 20, 60, 70)], segments);

    expect(pieces).toHaveLength(2);
    expect(pieces.map((piece) => piece.mode)).toEqual([5, 6]);
  });

  it('shares the boundary point so the coloured line has no hole in it', () => {
    const segments = modeSegments([change(0, 5), change(50, 6)], WINDOW);
    const [first, second] = splitByMode([run(0, 10, 20, 60, 70)], segments);

    expect(first?.points.at(-1)).toEqual(second?.points[0]);
    expect(first?.points.at(-1)?.tSeconds).toBe(60);
  });

  it('does not interpolate a position at the instant of the change', () => {
    // The mode changed at t = 50 and the nearest fixes are 20 and 60. A point at 50 would be a
    // coordinate no receiver reported (doc 04 §1 rule 6).
    const segments = modeSegments([change(0, 5), change(50, 6)], WINDOW);
    const times = splitByMode([run(0, 10, 20, 60, 70)], segments).flatMap((piece) =>
      piece.points.map((point) => point.tSeconds),
    );

    expect(times).not.toContain(50);
  });

  it('leaves one piece when the mode never changed', () => {
    const pieces = splitByMode([run(0, 10, 20)], modeSegments([change(0, 5)], WINDOW));

    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.points).toHaveLength(3);
  });
});

describe('a gap the log left stays a gap', () => {
  it('never joins two runs, even when they are in the same mode', () => {
    // buildGroundTrack breaks the path where the fix was lost. Splitting by mode subdivides those
    // runs; merging them would draw a leg that was never flown.
    const segments = modeSegments([change(0, 5)], WINDOW);
    const pieces = splitByMode([run(0, 10), run(40, 50)], segments);

    expect(pieces).toHaveLength(2);
    expect(pieces.map((piece) => piece.points.map((p) => p.tSeconds))).toEqual([
      [0, 10],
      [40, 50],
    ]);
  });

  it('keeps the hole when a mode change falls inside an outage', () => {
    const segments = modeSegments([change(0, 5), change(25, 6)], WINDOW);
    const pieces = splitByMode([run(0, 10), run(40, 50)], segments);

    expect(pieces.map((piece) => piece.mode)).toEqual([5, 6]);
    // No point bridges 10 → 40; the two pieces are not adjacent in time.
    expect(pieces[0]?.points.at(-1)?.tSeconds).toBe(10);
    expect(pieces[1]?.points[0]?.tSeconds).toBe(40);
  });

  it('drops nothing for an empty run', () => {
    expect(splitByMode([[]], modeSegments([change(0, 5)], WINDOW))).toEqual([]);
  });
});

describe('a stretch the log stated no mode for', () => {
  it('is its own piece, coloured as not recorded rather than as the next mode', () => {
    const segments = modeSegments([change(50, 6)], WINDOW);
    const [leading, recorded] = splitByMode([run(0, 10, 60, 70)], segments);

    expect(leading?.mode).toBeNull();
    expect(leading?.label).toBe('Mode not recorded');
    expect(leading?.colorIndex).toBe(-1);
    expect(recorded?.mode).toBe(6);
  });

  it('marks a piece whose mode boundary was inferred', () => {
    const segments = modeSegments([change(0, 5)], WINDOW);
    const [only] = splitByMode([run(0, 50)], segments);

    // The last segment ends where the data ends, which is not a transition the aircraft made.
    expect(only?.inferred).toBe(true);
  });

  it('colours nothing when the log carries no mode records at all', () => {
    const pieces = splitByMode([run(0, 10, 20)], modeSegments([], WINDOW));

    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.mode).toBeNull();
  });
});

describe('one colour per mode, everywhere', () => {
  it('gives a recurring mode the same colour each time it returns', () => {
    const segments = modeSegments([change(0, 5), change(30, 6), change(60, 5)], WINDOW);
    const pieces = splitByMode([run(0, 10, 40, 50, 70, 80)], segments);

    expect(pieces.map((piece) => piece.colorIndex)).toEqual([0, 1, 0]);
  });

  it('assigns the same colours the charts do, so map and chart agree', async () => {
    const { buildModeBands } = await import('@pandalog/reporting');
    const segments = modeSegments([change(0, 5), change(30, 6)], WINDOW);

    const bands = buildModeBands(segments, WINDOW, 100).map((band) => band.colorIndex);
    const pieces = splitByMode([run(0, 10, 40, 50)], segments).map((piece) => piece.colorIndex);

    expect(pieces).toEqual(bands);
  });
});

describe('the legend', () => {
  it('lists each mode once, in the order it was first flown', () => {
    const legend = modeLegend(modeSegments([change(0, 6), change(30, 5), change(60, 6)], WINDOW));

    expect(legend.map((entry) => entry.label)).toEqual(['Mode 6', 'Mode 5']);
  });

  it('includes the not-recorded period, because it is on the map too', () => {
    const legend = modeLegend(modeSegments([change(20, 5)], WINDOW));

    expect(legend.map((entry) => entry.label)).toEqual(['Mode not recorded', 'Mode 5']);
    expect(legend[0]?.inferred).toBe(true);
  });
});
