/**
 * Alignment — 05_IMPLEMENTATION_ROADMAP.md Phase C acceptance:
 *
 * > Two signals with different `TimeBase.origin` cannot be silently aligned without the query
 * > surfacing the `syncUncertaintySeconds` used.
 */
import { describe, expect, it } from 'vitest';

import { createSignal, createTimeBase } from '@pandalog/core-domain';
import { alignSignals, commonTimeSpan, QueryError } from '@pandalog/query';
import { Validity, type Signal, type TimeBase } from '@pandalog/schema';

const boot = createTimeBase({ origin: 'BOOT' });

const signalOn = (id: string, base: TimeBase, times: number[]): Signal =>
  createSignal({
    id,
    unit: 'm',
    sourceUnit: 'm',
    timeBase: base,
    samples: times.map((t) => ({ t_rel_seconds: t, value: t * 2, validity: Validity.VALID })),
  });

describe('alignSignals', () => {
  it('resamples every input onto the shared grid', () => {
    const result = alignSignals([signalOn('a', boot, [0, 1, 2]), signalOn('b', boot, [0, 1, 2])], {
      times: [0.5, 1.5],
      maxGapSeconds: 2,
    });

    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]?.samples).toHaveLength(2);
    expect(Array.from(result.times)).toEqual([0.5, 1.5]);
  });

  it('reports zero uncertainty for signals sharing one clock', () => {
    // A real claim, not a placeholder: samples from one boot clock share a timebase exactly.
    const result = alignSignals([signalOn('a', boot, [0, 1]), signalOn('b', boot, [0, 1])], {
      times: [0.5],
      maxGapSeconds: 2,
    });

    expect(result.originsDiffer).toBe(false);
    expect(result.syncUncertaintySeconds).toBe(0);
  });

  describe('across different time origins', () => {
    const armed = (uncertainty: number | null): TimeBase =>
      createTimeBase({
        origin: 'ARM',
        epochUtc: '2026-01-01T00:00:00.000Z',
        ...(uncertainty === null ? {} : { syncUncertaintySeconds: uncertainty }),
      });

    const booted = (uncertainty: number | null): TimeBase =>
      createTimeBase({
        origin: 'BOOT',
        ...(uncertainty === null ? {} : { syncUncertaintySeconds: uncertainty }),
      });

    it('refuses when either side has unstated synchronisation', () => {
      expect(() =>
        alignSignals([signalOn('a', booted(null), [0, 1]), signalOn('b', armed(0.01), [0, 1])], {
          times: [0.5],
          maxGapSeconds: 2,
        }),
      ).toThrow(QueryError);
    });

    it('reports UNKNOWN_SYNCHRONISATION with the offending signal named', () => {
      try {
        alignSignals(
          [signalOn('gyro', booted(null), [0, 1]), signalOn('gps', armed(0.02), [0, 1])],
          {
            times: [0.5],
            maxGapSeconds: 2,
          },
        );
        expect.unreachable('should have thrown');
      } catch (error) {
        const queryError = error as QueryError;
        expect(queryError.code).toBe('UNKNOWN_SYNCHRONISATION');
        expect(queryError.context.signalId).toBe('gyro');
      }
    });

    it('aligns when both sides declare an uncertainty, and surfaces the combined figure', () => {
      const result = alignSignals(
        [signalOn('a', booted(0.03), [0, 1]), signalOn('b', armed(0.04), [0, 1])],
        { times: [0.5], maxGapSeconds: 2 },
      );

      expect(result.originsDiffer).toBe(true);
      // Quadrature sum of independent one-sigma estimates: sqrt(0.03^2 + 0.04^2) = 0.05.
      expect(result.syncUncertaintySeconds).toBeCloseTo(0.05, 12);
    });

    it('surfaces a zero combined uncertainty only when both sides claim zero', () => {
      const result = alignSignals(
        [signalOn('a', booted(0), [0, 1]), signalOn('b', armed(0), [0, 1])],
        { times: [0.5], maxGapSeconds: 2 },
      );

      expect(result.syncUncertaintySeconds).toBe(0);
      expect(result.originsDiffer).toBe(true);
    });
  });

  it('rejects an empty input list', () => {
    expect(() => alignSignals([], { times: [0], maxGapSeconds: 1 })).toThrow(QueryError);
  });
});

describe('commonTimeSpan', () => {
  it('returns the overlap of every signal', () => {
    const span = commonTimeSpan([signalOn('a', boot, [0, 5]), signalOn('b', boot, [2, 8])]);

    expect(span).toEqual({ startSeconds: 2, endSeconds: 5 });
  });

  it('returns null when the signals never overlap', () => {
    expect(commonTimeSpan([signalOn('a', boot, [0, 1]), signalOn('b', boot, [5, 6])])).toBeNull();
  });

  it('returns null when a signal is empty', () => {
    expect(commonTimeSpan([signalOn('a', boot, [0, 1]), signalOn('b', boot, [])])).toBeNull();
  });
});
