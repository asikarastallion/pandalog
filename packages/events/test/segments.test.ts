/**
 * Mode intervals, and the boundaries a log does not contain — ADR-0016.
 *
 * The interesting cases here are all absences. A log that begins mid-flight never says what mode
 * the aircraft was in when recording started, and a log that ends mid-flight never records the last
 * mode ending. `ARM_DISARM_DETECTOR` refuses to invent those boundaries for the armed interval;
 * these tests hold this module to the same standard, because the consequence is visual rather than
 * numeric and therefore easier to let slide: a track coloured LOITER for a stretch nothing asserted
 * LOITER for is a picture of a flight that was not flown.
 */
import { describe, expect, it } from 'vitest';

import { createFlightEvent, modeSegments, modesIn, type FlightEvent } from '@pandalog/events';

const detector = { name: 'events:mode-change', version: '1.0.0' };

const change = (tSeconds: number, mode: number | null): FlightEvent =>
  createFlightEvent({
    id: `event:mode-change:${String(tSeconds)}`,
    type: 'mode-change',
    t_start_seconds: tSeconds,
    detector,
    payload: mode === null ? { Rsn: 1 } : { Mode: mode, ModeNum: mode, Rsn: 1 },
  });

const other = (tSeconds: number): FlightEvent =>
  createFlightEvent({
    id: `event:logged-error:${String(tSeconds)}`,
    type: 'logged-error',
    t_start_seconds: tSeconds,
    detector: { name: 'events:logged-error', version: '1.0.0' },
    payload: {},
  });

const window = { startSeconds: 0, endSeconds: 100 };

describe('pairing changes into intervals', () => {
  it('runs each mode until the next change', () => {
    const segments = modeSegments([change(0, 5), change(30, 6), change(70, 5)], window);

    expect(segments.map((s) => [s.mode, s.startSeconds, s.endSeconds])).toEqual([
      [5, 0, 30],
      [6, 30, 70],
      [5, 70, 100],
    ]);
  });

  it('ignores events that are not mode changes', () => {
    const segments = modeSegments([change(0, 5), other(10), change(30, 6)], window);

    expect(segments).toHaveLength(2);
  });

  it('sorts changes that arrive out of order', () => {
    const segments = modeSegments([change(30, 6), change(0, 5)], window);

    expect(segments.map((s) => s.mode)).toEqual([5, 6]);
  });

  it('drops a mode that was superseded in the same instant', () => {
    // Two changes at one timestamp: the first was never in effect for any duration, so it is not
    // an interval. The transition is still in the event list; this function describes periods.
    const segments = modeSegments([change(0, 5), change(30, 6), change(30, 7)], window);

    expect(segments.map((s) => [s.mode, s.startSeconds, s.endSeconds])).toEqual([
      [5, 0, 30],
      [7, 30, 100],
    ]);
  });
});

describe('the boundaries the log does not contain', () => {
  it('does not carry the first mode backwards over a log that began mid-flight', () => {
    const segments = modeSegments([change(12, 5)], window);
    const [leading, first] = segments;

    // Null, not 5. The aircraft was in some mode for those twelve seconds and the log never said
    // which; colouring it 5 would assert something no record supports.
    expect(leading?.mode).toBeNull();
    expect(leading?.startSeconds).toBe(0);
    expect(leading?.endSeconds).toBe(12);
    expect(first?.mode).toBe(5);
  });

  it('marks an inferred start as inferred and a recorded one as recorded', () => {
    const [leading, first] = modeSegments([change(12, 5)], window);

    expect(leading?.startsAtLoggedChange).toBe(false);
    expect(leading?.endsAtLoggedChange).toBe(true);
    expect(first?.startsAtLoggedChange).toBe(true);
  });

  it('marks the final segment as ending where the data ends, not at a transition', () => {
    const segments = modeSegments([change(0, 5), change(30, 6)], window);
    const last = segments[segments.length - 1];

    expect(last?.endsAtLoggedChange).toBe(false);
    expect(last?.endSeconds).toBe(window.endSeconds);
    expect(segments[0]?.endsAtLoggedChange).toBe(true);
  });

  it('adds no leading segment when the first change is at the start of the data', () => {
    const segments = modeSegments([change(0, 5)], window);

    // A zero-width period is not a period.
    expect(segments).toHaveLength(1);
    expect(segments[0]?.startsAtLoggedChange).toBe(true);
  });

  it('describes a flight with no mode records as one unknown period, not as nothing', () => {
    // Returning [] would let a caller draw an uncoloured track and read it as "the mode never
    // changed" rather than "the log carries no mode information".
    const segments = modeSegments([other(5)], window);

    expect(segments).toEqual([
      {
        mode: null,
        startSeconds: 0,
        endSeconds: 100,
        startsAtLoggedChange: false,
        endsAtLoggedChange: false,
        startEventId: null,
      },
    ]);
  });

  it('reports a mode of null when the record carried no usable number', () => {
    const segments = modeSegments([change(0, null)], window);

    expect(segments[0]?.mode).toBeNull();
  });

  it('cites the event a recorded segment began at, and nothing for an inferred one', () => {
    const [leading, first] = modeSegments([change(12, 5)], window);

    expect(leading?.startEventId).toBeNull();
    expect(first?.startEventId).toBe('event:mode-change:12');
  });
});

describe('clipping to the data', () => {
  it('drops a change outside the window rather than stretching the timeline to it', () => {
    const segments = modeSegments([change(-5, 4), change(10, 5), change(500, 9)], window);

    expect(segments.map((s) => s.mode)).toEqual([null, 5]);
    expect(segments[segments.length - 1]?.endSeconds).toBe(100);
  });

  it('returns nothing for a window with no extent', () => {
    expect(modeSegments([change(0, 5)], { startSeconds: 4, endSeconds: 4 })).toEqual([]);
    expect(modeSegments([change(0, 5)], { startSeconds: 9, endSeconds: 2 })).toEqual([]);
  });
});

describe('listing the modes present', () => {
  it('returns each distinct mode once, in first-seen order', () => {
    const segments = modeSegments([change(0, 5), change(10, 6), change(20, 5)], window);

    expect(modesIn(segments)).toEqual([5, 6]);
  });

  it('excludes the unknown period, which is not a mode', () => {
    expect(modesIn(modeSegments([change(12, 5)], window))).toEqual([5]);
    expect(modesIn(modeSegments([], window))).toEqual([]);
  });
});
