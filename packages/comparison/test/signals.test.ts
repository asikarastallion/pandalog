/**
 * Signal comparison — 05_IMPLEMENTATION_ROADMAP.md Phase J.
 *
 * The load-bearing test in this file is the one that refuses to call two signals the same when
 * nothing in them was actually compared. A comparator that reports "no material difference" for a
 * pair it never managed to line up is the comparison-shaped version of a PASS with no evidence.
 */
import { describe, expect, it } from 'vitest';

import { compareSignals, resolveTimeAlignment } from '@pandalog/comparison';

import { buildDataset, FLAT } from './support/subjects.js';

const alignmentOf = (a: ReturnType<typeof buildDataset>, b: ReturnType<typeof buildDataset>) =>
  resolveTimeAlignment(a.timeBase, b.timeBase);

const compare = (
  baseline: ReturnType<typeof buildDataset>,
  subject: ReturnType<typeof buildDataset>,
  options = {},
) => compareSignals(baseline, subject, alignmentOf(baseline, subject), options);

const differenceFor = (result: ReturnType<typeof compare>, signalId: string) => {
  const found = result.differences.find((entry) => entry.signalId === signalId);
  if (found === undefined) {
    throw new Error(`No difference entry for ${signalId}; got ${result.differences.length}.`);
  }
  return found;
};

describe('compareSignals', () => {
  it('finds no material difference between a flight and itself', () => {
    const dataset = buildDataset(FLAT);
    const result = compare(dataset, dataset);

    expect(result.verdict).toBe('SAME');
    expect(result.onlyInBaseline).toEqual([]);
    expect(result.onlyInSubject).toEqual([]);
    expect(differenceFor(result, 'sensor.a').aligned?.maxAbsoluteDifference).toBe(0);
  });

  it('reports which signals exist on only one side rather than ignoring them', () => {
    const baseline = buildDataset({ signals: [...FLAT.signals, { id: 'sensor.c', at: () => 1 }] });
    const subject = buildDataset({ signals: [...FLAT.signals, { id: 'sensor.d', at: () => 1 }] });

    const result = compare(baseline, subject);

    expect(result.onlyInBaseline).toEqual(['sensor.c']);
    expect(result.onlyInSubject).toEqual(['sensor.d']);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('calls a shifted signal different once it leaves the tolerance', () => {
    const baseline = buildDataset({ signals: [{ id: 'sensor.a', at: (t) => Math.sin(t) }] });
    const subject = buildDataset({ signals: [{ id: 'sensor.a', at: (t) => Math.sin(t) + 0.5 }] });

    const result = compare(baseline, subject);
    const difference = differenceFor(result, 'sensor.a');

    expect(difference.verdict).toBe('DIFFERENT');
    expect(difference.method).toBe('time-aligned');
    expect(difference.aligned?.maxAbsoluteDifference).toBeCloseTo(0.5, 9);
    expect(difference.aligned?.firstExceedanceSeconds).toBe(0);
  });

  it('keeps a signal that moved less than the tolerance the same', () => {
    const baseline = buildDataset({ signals: [{ id: 'sensor.a', at: (t) => Math.sin(t) }] });
    const subject = buildDataset({ signals: [{ id: 'sensor.a', at: (t) => Math.sin(t) + 0.001 }] });

    const difference = differenceFor(compare(baseline, subject), 'sensor.a');

    expect(difference.verdict).toBe('SAME');
    expect(difference.aligned?.firstExceedanceSeconds).toBeNull();
  });

  it('scales the tolerance to the baseline signal, not to an absolute number', () => {
    // The same 0.5 offset is a 25% excursion on a signal that swings by 2 and a 0.25% excursion on
    // one that swings by 200. A single absolute tolerance would have to be wrong for one of them.
    const small = buildDataset({ signals: [{ id: 's', at: (t) => Math.sin(t) }] });
    const smallShifted = buildDataset({ signals: [{ id: 's', at: (t) => Math.sin(t) + 0.5 }] });
    const large = buildDataset({ signals: [{ id: 's', at: (t) => 100 * Math.sin(t) }] });
    const largeShifted = buildDataset({
      signals: [{ id: 's', at: (t) => 100 * Math.sin(t) + 0.5 }],
    });

    expect(differenceFor(compare(small, smallShifted), 's').verdict).toBe('DIFFERENT');
    expect(differenceFor(compare(large, largeShifted), 's').verdict).toBe('SAME');
  });

  it('demands exact equality when the baseline signal never moved', () => {
    // A constant baseline has zero range, so a relative tolerance would be zero-width. That is the
    // right answer rather than a degenerate one: any movement at all is the whole of the change.
    const baseline = buildDataset({ signals: [{ id: 's', at: () => 4 }] });
    const same = buildDataset({ signals: [{ id: 's', at: () => 4 }] });
    const moved = buildDataset({ signals: [{ id: 's', at: () => 4.0001 }] });

    expect(differenceFor(compare(baseline, same), 's').verdict).toBe('SAME');
    expect(differenceFor(compare(baseline, moved), 's').verdict).toBe('DIFFERENT');
  });

  it('refuses to compare two signals that are not the same quantity', () => {
    const baseline = buildDataset({ signals: [{ id: 's', unit: 'm', at: () => 1 }] });
    const subject = buildDataset({ signals: [{ id: 's', unit: 'rad', at: () => 1 }] });

    const difference = differenceFor(compare(baseline, subject), 's');

    expect(difference.verdict).toBe('INCOMPARABLE');
    expect(difference.reason).toContain('m');
    expect(difference.reason).toContain('rad');
  });

  it('refuses to compare signals whose time windows never overlap', () => {
    const baseline = buildDataset({
      signals: [{ id: 's', at: () => 1, startSeconds: 0, sampleCount: 11 }],
    });
    const subject = buildDataset({
      signals: [{ id: 's', at: () => 1, startSeconds: 100, sampleCount: 11 }],
    });

    const difference = differenceFor(compare(baseline, subject), 's');

    expect(difference.verdict).toBe('INCOMPARABLE');
    expect(difference.reason).toMatch(/overlap/i);
  });

  it('never calls two signals the same when no point in either was usable', () => {
    // Both sides are present, same unit, same window — and entirely MISSING. There is nothing to
    // compare, and "no material difference" would be a claim the data does not support.
    const empty = { id: 's', at: () => null };
    const baseline = buildDataset({ signals: [empty] });
    const subject = buildDataset({ signals: [empty] });

    const difference = differenceFor(compare(baseline, subject), 's');

    expect(difference.verdict).toBe('INCOMPARABLE');
    expect(difference.aligned).toBeNull();
  });

  it('falls back to the distribution rather than giving up on a signal too sparse to grid', () => {
    // One usable sample cannot define a sample rate, so no grid can be put through it. Declaring
    // that INCOMPARABLE would throw away a comparison that is perfectly well defined: a single
    // measured value has a range, a mean and an RMS, and they can be checked against the baseline's.
    const single = { id: 's', at: (t: number) => (t === 0 ? 7 : null), sampleCount: 20 };
    const result = compare(
      buildDataset({ signals: [single] }),
      buildDataset({ signals: [single] }),
    );
    const difference = differenceFor(result, 's');

    expect(difference.method).toBe('distribution-only');
    expect(difference.verdict).toBe('SAME');
    expect(difference.baseline?.valueBearingCount).toBe(1);
    expect(difference.baseline?.nominalIntervalSeconds).toBeNull();
    expect(difference.reason).toMatch(/too sparse/i);
  });

  it('compares two signals that share exactly one instant', () => {
    const baseline = buildDataset({
      signals: [{ id: 's', at: (t) => t, startSeconds: 0, sampleCount: 11 }],
    });
    const subject = buildDataset({
      signals: [{ id: 's', at: (t) => t, startSeconds: 1, sampleCount: 11 }],
    });

    // Baseline covers [0, 1] and subject [1, 2]: a zero-width overlap at t = 1, which is still a
    // real point at which both flights measured something.
    const difference = differenceFor(compare(baseline, subject), 's');

    expect(difference.method).toBe('time-aligned');
    expect(difference.aligned?.window).toEqual({ startSeconds: 1, endSeconds: 1 });
    expect(difference.aligned?.comparedPoints).toBe(1);
    expect(difference.verdict).toBe('SAME');
  });

  it('reports a signal that lost its data as different, not as incomparable', () => {
    // Only one side is empty. That is a real, reportable change in the flight, not a failure to
    // compare — and collapsing it into INCOMPARABLE would hide a regression.
    const baseline = buildDataset({ signals: [{ id: 's', at: (t) => Math.sin(t) }] });
    const subject = buildDataset({ signals: [{ id: 's', at: () => null }] });

    const difference = differenceFor(compare(baseline, subject), 's');

    expect(difference.verdict).toBe('DIFFERENT');
    expect(difference.subject?.range).toBeNull();
    expect(difference.subject?.coverage).toBe(0);
  });

  it('falls back to distribution comparison when the flights share no time axis', () => {
    const baseline = buildDataset({ ...FLAT, origin: 'BOOT' });
    const subject = buildDataset({ ...FLAT, origin: 'ARM' });

    const result = compare(baseline, subject);
    const difference = differenceFor(result, 'sensor.a');

    expect(difference.method).toBe('distribution-only');
    expect(difference.aligned).toBeNull();
    // Same numbers, no shared clock: the distributions match and the report says that is all it
    // checked.
    expect(difference.verdict).toBe('SAME');
    expect(result.reason).toMatch(/distribution/i);
  });

  it('describes a signal with no samples without inventing a coverage of zero', () => {
    const baseline = buildDataset({ signals: [{ id: 's', at: () => 1, sampleCount: 0 }] });
    const subject = buildDataset({ signals: [{ id: 's', at: () => 1, sampleCount: 0 }] });

    const difference = differenceFor(compare(baseline, subject), 's');

    expect(difference.baseline?.sampleCount).toBe(0);
    expect(difference.baseline?.coverage).toBeNull();
    expect(difference.verdict).toBe('INCOMPARABLE');
  });

  it('still reports the axis when a signal neither flight logged cannot be compared', () => {
    // A signal is an element of this axis, not an axis of its own. Letting one unlogged sensor
    // make the whole comparison unexaminable would throw away every real result to describe an
    // absence — so the caveat is carried by name instead.
    const spec = {
      signals: [
        { id: 'sensor.a', at: (t: number) => Math.sin(t) },
        { id: 'vibration.x', at: () => null },
      ],
    };
    const result = compare(buildDataset(spec), buildDataset(spec));

    expect(result.verdict).toBe('SAME');
    expect(result.incomparable).toEqual(['vibration.x']);
    expect(differenceFor(result, 'vibration.x').verdict).toBe('INCOMPARABLE');
    expect(result.reason).toContain('1 signal(s) actually contributed');
  });

  it('reports the axis as incomparable when not one signal could be compared', () => {
    const spec = {
      signals: [
        { id: 'vibration.x', at: () => null },
        { id: 'vibration.y', at: () => null },
      ],
    };
    const result = compare(buildDataset(spec), buildDataset(spec));

    expect(result.verdict).toBe('INCOMPARABLE');
    expect(result.incomparable).toEqual(['vibration.x', 'vibration.y']);
  });

  it('lets a real difference outweigh an unexaminable signal', () => {
    const baseline = buildDataset({
      signals: [
        { id: 'sensor.a', at: (t) => Math.sin(t) },
        { id: 'vibration.x', at: () => null },
      ],
    });
    const subject = buildDataset({
      signals: [
        { id: 'sensor.a', at: (t) => Math.sin(t) + 0.5 },
        { id: 'vibration.x', at: () => null },
      ],
    });

    expect(compare(baseline, subject).verdict).toBe('DIFFERENT');
  });

  it('orders its output by signal id so two runs produce the same report', () => {
    const spec = {
      signals: [
        { id: 'z.signal', at: () => 1 },
        { id: 'a.signal', at: () => 1 },
        { id: 'm.signal', at: () => 1 },
      ],
    };
    const result = compare(buildDataset(spec), buildDataset(spec));

    expect(result.differences.map((entry) => entry.signalId)).toEqual([
      'a.signal',
      'm.signal',
      'z.signal',
    ]);
  });
});
