/** Event comparison — matching two flights' timelines without inventing correspondences. */
import { createTimeBase } from '@pandalog/core-domain';
import { describe, expect, it } from 'vitest';

import { compareEvents, resolveTimeAlignment } from '@pandalog/comparison';

import { buildEvent, type EventSpec } from './support/subjects.js';

const aligned = resolveTimeAlignment(
  createTimeBase({ origin: 'BOOT' }),
  createTimeBase({ origin: 'BOOT' }),
);

const unaligned = resolveTimeAlignment(
  createTimeBase({ origin: 'BOOT' }),
  createTimeBase({ origin: 'ARM' }),
);

const events = (specs: readonly EventSpec[]) => specs.map((spec, index) => buildEvent(spec, index));

describe('compareEvents', () => {
  it('matches a flight against itself with nothing left over', () => {
    const timeline = events([
      { type: 'mode-change', startSeconds: 1 },
      { type: 'gps-fix-loss', startSeconds: 3, endSeconds: 6 },
    ]);

    const result = compareEvents(timeline, timeline, aligned, {});

    expect(result.verdict).toBe('SAME');
    expect(result.matched).toHaveLength(2);
    expect(result.onlyInBaseline).toEqual([]);
    expect(result.onlyInSubject).toEqual([]);
    expect(result.matched.every((match) => match.deltaSeconds === 0)).toBe(true);
  });

  it('matches events of the same type that moved a little', () => {
    const baseline = events([{ type: 'mode-change', startSeconds: 10 }]);
    const subject = events([{ type: 'mode-change', startSeconds: 10.4 }]);

    const result = compareEvents(baseline, subject, aligned, {});

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.deltaSeconds).toBeCloseTo(0.4, 9);
    expect(result.verdict).toBe('SAME');
  });

  it('leaves an event unmatched once it has moved further than the tolerance', () => {
    const baseline = events([{ type: 'mode-change', startSeconds: 10 }]);
    const subject = events([{ type: 'mode-change', startSeconds: 40 }]);

    const result = compareEvents(baseline, subject, aligned, {});

    expect(result.matched).toEqual([]);
    expect(result.onlyInBaseline).toHaveLength(1);
    expect(result.onlyInSubject).toHaveLength(1);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('never matches events of different types, however close they are', () => {
    // A mode change and a fix loss at the same instant are two different facts. Matching them
    // because they are adjacent would make the report claim the flight did something it did not.
    const baseline = events([{ type: 'mode-change', startSeconds: 5 }]);
    const subject = events([{ type: 'gps-fix-loss', startSeconds: 5 }]);

    const result = compareEvents(baseline, subject, aligned, {});

    expect(result.matched).toEqual([]);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('matches each event at most once when several are in range', () => {
    const baseline = events([{ type: 'mode-change', startSeconds: 10 }]);
    const subject = events([
      { type: 'mode-change', startSeconds: 10.1 },
      { type: 'mode-change', startSeconds: 10.2 },
    ]);

    const result = compareEvents(baseline, subject, aligned, {});

    expect(result.matched).toHaveLength(1);
    // The nearer one is the match; the other is a genuinely extra event.
    expect(result.matched[0]?.deltaSeconds).toBeCloseTo(0.1, 9);
    expect(result.onlyInSubject).toHaveLength(1);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('reports counts by type so a reader can see what changed at a glance', () => {
    const baseline = events([
      { type: 'mode-change', startSeconds: 1 },
      { type: 'mode-change', startSeconds: 2 },
    ]);
    const subject = events([{ type: 'gps-fix-loss', startSeconds: 1 }]);

    const result = compareEvents(baseline, subject, aligned, {});

    expect(result.countsByType).toEqual([
      { type: 'gps-fix-loss', baseline: 0, subject: 1 },
      { type: 'mode-change', baseline: 2, subject: 0 },
    ]);
  });

  it('compares counts but not timing when the flights share no time axis', () => {
    const baseline = events([{ type: 'mode-change', startSeconds: 1 }]);
    const subject = events([{ type: 'mode-change', startSeconds: 900 }]);

    const result = compareEvents(baseline, subject, unaligned, {});

    expect(result.method).toBe('count-only');
    expect(result.matched).toEqual([]);
    // The counts agree; the timing was never compared, and the report says only what it checked.
    expect(result.verdict).toBe('SAME');
    expect(result.reason).toMatch(/count/i);
  });

  it('finds a count difference even without a shared time axis', () => {
    const baseline = events([
      { type: 'mode-change', startSeconds: 1 },
      { type: 'mode-change', startSeconds: 2 },
    ]);
    const subject = events([{ type: 'mode-change', startSeconds: 900 }]);

    expect(compareEvents(baseline, subject, unaligned, {}).verdict).toBe('DIFFERENT');
  });

  it('is not sensitive to the order events are handed to it', () => {
    const forwards = events([
      { type: 'mode-change', startSeconds: 1 },
      { type: 'mode-change', startSeconds: 9 },
    ]);
    const backwards = [...forwards].reverse();

    const result = compareEvents(forwards, backwards, aligned, {});

    expect(result.verdict).toBe('SAME');
    expect(result.matched.map((match) => match.deltaSeconds)).toEqual([0, 0]);
  });
});
