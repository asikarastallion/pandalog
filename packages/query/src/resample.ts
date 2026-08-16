/**
 * Resampling — 05_IMPLEMENTATION_ROADMAP.md Phase C, ADR-0007.
 *
 * This is where ADR-0007 earns its keep. Every output point is one of two honest things:
 *
 *   INTERPOLATED + a finite value  — two value-bearing neighbours close enough to interpolate over
 *   MISSING      + NaN             — no support: outside the data, or across a gap too wide
 *
 * There is no third option and no extrapolation. Beyond the first and last sample the signal says
 * nothing, and inventing values there is how a plot grows a plausible tail that never happened.
 *
 * `maxGapSeconds` is the caller's declaration of how far interpolation stays meaningful for their
 * data. It is required rather than defaulted: the right value depends on the signal's native rate
 * and on what the number means, which this module cannot know. A 1 s gap in barometric altitude is
 * routine; the same gap in a 400 Hz gyro trace is a hole.
 */
import { createSignalFromColumns, VALIDITY_CODES, type SignalColumns } from '@pandalog/core-domain';
import { Validity, type Signal } from '@pandalog/schema';

import { QueryError } from './errors.js';

export interface ResampleOptions {
  /** Target times, finite and strictly increasing. */
  readonly times: ArrayLike<number>;
  /**
   * Widest interval between two supporting samples that may be interpolated across. A target point
   * whose neighbours are further apart than this becomes MISSING rather than a guess.
   */
  readonly maxGapSeconds: number;
}

/** A uniform time grid, for callers that want one. */
export function uniformGrid(
  startSeconds: number,
  endSeconds: number,
  rateHz: number,
): Float64Array {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !(rateHz > 0)) {
    throw new QueryError(
      'INVALID_GRID',
      `uniformGrid needs finite bounds and a positive rate; got start=${String(startSeconds)}, ` +
        `end=${String(endSeconds)}, rateHz=${String(rateHz)}.`,
      { startSeconds, endSeconds, rateHz },
    );
  }
  const step = 1 / rateHz;
  const count = Math.max(0, Math.floor((endSeconds - startSeconds) / step) + 1);
  const grid = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    grid[i] = startSeconds + i * step;
  }
  return grid;
}

/**
 * Read an index that the surrounding bounds have already proven valid.
 *
 * `noUncheckedIndexedAccess` cannot see that proof, and neither a non-null assertion nor a
 * fallback value is acceptable here: one hides a real bug, the other invents a measurement.
 */
function at(column: ArrayLike<number>, index: number): number {
  const value = column[index];
  if (value === undefined) {
    throw new QueryError('INVALID_GRID', `Index ${String(index)} is out of range.`, { index });
  }
  return value;
}

function assertGrid(times: ArrayLike<number>): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    if (t === undefined || !Number.isFinite(t) || t <= previous) {
      throw new QueryError(
        'INVALID_GRID',
        `Resample grid must be finite and strictly increasing; index ${String(i)} is ${String(t)}.`,
        { index: i, value: t },
      );
    }
    previous = t;
  }
}

/** Indices of the value-bearing samples, which are the only ones that can support interpolation. */
function supportIndices(columns: SignalColumns): number[] {
  const support: number[] = [];
  const valid = VALIDITY_CODES[Validity.VALID];
  const interpolated = VALIDITY_CODES[Validity.INTERPOLATED];
  for (let i = 0; i < columns.validity.length; i += 1) {
    const code = columns.validity[i];
    if (code === valid || code === interpolated) {
      support.push(i);
    }
  }
  return support;
}

/**
 * Resample a signal onto a new time grid.
 *
 * A target time landing exactly on a value-bearing source sample keeps that sample's value and
 * validity — it was measured, not interpolated, and saying otherwise would understate the data.
 *
 * @throws {QueryError} when the grid is not finite and strictly increasing.
 */
export function resampleSignal(signal: Signal, options: ResampleOptions): Signal {
  assertGrid(options.times);

  const columns = sourceColumns(signal);
  const support = supportIndices(columns);
  const count = options.times.length;

  const t = new Float64Array(count);
  const values = new Float64Array(count);
  const validity = new Uint8Array(count);

  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const target = at(options.times, i);
    t[i] = target;

    // Advance to the last support point at or before the target.
    while (cursor + 1 < support.length && at(columns.t, at(support, cursor + 1)) <= target) {
      cursor += 1;
    }

    const leftIndex = support[cursor];
    const rightIndex = support[cursor + 1];

    if (leftIndex === undefined) {
      values[i] = NaN;
      validity[i] = VALIDITY_CODES[Validity.MISSING];
      continue;
    }

    const leftTime = at(columns.t, leftIndex);

    if (leftTime === target) {
      values[i] = at(columns.values, leftIndex);
      validity[i] = at(columns.validity, leftIndex);
      continue;
    }

    // Before the first support point, or after the last: no extrapolation, ever.
    if (target < leftTime || rightIndex === undefined) {
      values[i] = NaN;
      validity[i] = VALIDITY_CODES[Validity.MISSING];
      continue;
    }

    const rightTime = at(columns.t, rightIndex);
    if (rightTime - leftTime > options.maxGapSeconds) {
      values[i] = NaN;
      validity[i] = VALIDITY_CODES[Validity.MISSING];
      continue;
    }

    const ratio = (target - leftTime) / (rightTime - leftTime);
    const leftValue = at(columns.values, leftIndex);
    const rightValue = at(columns.values, rightIndex);
    const interpolated = leftValue + ratio * (rightValue - leftValue);

    if (Number.isFinite(interpolated)) {
      values[i] = interpolated;
      validity[i] = VALIDITY_CODES[Validity.INTERPOLATED];
    } else {
      values[i] = NaN;
      validity[i] = VALIDITY_CODES[Validity.MISSING];
    }
  }

  return createSignalFromColumns({
    id: signal.id,
    unit: signal.unit,
    sourceUnit: signal.sourceUnit,
    timeBase: signal.timeBase,
    columns: { t, values, validity },
    derived: true,
    derivation: {
      method: 'query:resample-linear',
      version: '1.0.0',
      inputs: [signal.id],
    },
  });
}

/** Columns for a signal, materialised if it was not built by core-domain. */
export function sourceColumns(signal: Signal): SignalColumns {
  const length = signal.samples.length;
  const t = new Float64Array(length);
  const values = new Float64Array(length);
  const validity = new Uint8Array(length);

  for (const [index, sample] of signal.samples.entries()) {
    t[index] = sample.t_rel_seconds;
    values[index] = sample.value;
    validity[index] = VALIDITY_CODES[sample.validity];
  }

  return { t, values, validity };
}
