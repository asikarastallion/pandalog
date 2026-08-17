/**
 * What a signal looks like on its own, before any comparison.
 *
 * Every field that has no answer is `null` rather than a number standing in for one (doc 04 §1
 * rule 6). A signal with no samples has no coverage — not 0% coverage — and a signal with nothing
 * value-bearing has no minimum, because the minimum of an empty set is not zero. The distinction
 * survives into the report, where "this flight logged nothing here" and "this flight logged zero"
 * are answers a reader must be able to tell apart.
 */
import { getSignalColumns, VALIDITY_CODES, type SignalColumns } from '@pandalog/core-domain';
import { sourceColumns, type TimeWindow } from '@pandalog/query';
import { Validity, type CanonicalUnit, type Signal } from '@pandalog/schema';

export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export interface SignalStatistics {
  readonly unit: CanonicalUnit;
  readonly sampleCount: number;
  readonly valueBearingCount: number;
  /** Value-bearing fraction, or null when there were no samples at all. */
  readonly coverage: number | null;
  /** Null when nothing was value-bearing. */
  readonly range: ValueRange | null;
  readonly mean: number | null;
  readonly rms: number | null;
  /** The span the samples actually cover, or null when there are none. */
  readonly span: TimeWindow | null;
  /**
   * Mean interval between value-bearing samples, or null when there are fewer than two. Used to
   * choose a comparison grid and an interpolation gap from the data rather than from an assumption.
   */
  readonly nominalIntervalSeconds: number | null;
}

/** Columns without a copy when core-domain already built them, with one when it did not. */
export const columnsOf = (signal: Signal): SignalColumns =>
  getSignalColumns(signal) ?? sourceColumns(signal);

const VALID_CODE = VALIDITY_CODES[Validity.VALID];
const INTERPOLATED_CODE = VALIDITY_CODES[Validity.INTERPOLATED];

/** True for the validity codes that carry a usable number (doc 02 §3 invariant 1a). */
export const isValueBearingCode = (code: number | undefined): boolean =>
  code === VALID_CODE || code === INTERPOLATED_CODE;

export function summariseSignal(signal: Signal): SignalStatistics {
  const columns = columnsOf(signal);
  const sampleCount = columns.t.length;

  let valueBearingCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  let totalSquares = 0;
  let firstValueBearing = Number.NaN;
  let lastValueBearing = Number.NaN;

  for (let index = 0; index < sampleCount; index += 1) {
    if (!isValueBearingCode(columns.validity[index])) {
      continue;
    }

    const value = columns.values[index] ?? Number.NaN;
    const t = columns.t[index] ?? Number.NaN;
    valueBearingCount += 1;
    min = Math.min(min, value);
    max = Math.max(max, value);
    total += value;
    totalSquares += value * value;
    if (valueBearingCount === 1) {
      firstValueBearing = t;
    }
    lastValueBearing = t;
  }

  const first = columns.t[0];
  const last = columns.t[sampleCount - 1];
  const span: TimeWindow | null =
    first === undefined || last === undefined ? null : { startSeconds: first, endSeconds: last };

  const valueBearingSpanSeconds = lastValueBearing - firstValueBearing;
  const nominalIntervalSeconds =
    valueBearingCount >= 2 && valueBearingSpanSeconds > 0
      ? valueBearingSpanSeconds / (valueBearingCount - 1)
      : null;

  return Object.freeze({
    unit: signal.unit,
    sampleCount,
    valueBearingCount,
    coverage: sampleCount === 0 ? null : valueBearingCount / sampleCount,
    range: valueBearingCount === 0 ? null : Object.freeze({ min, max }),
    mean: valueBearingCount === 0 ? null : total / valueBearingCount,
    rms: valueBearingCount === 0 ? null : Math.sqrt(totalSquares / valueBearingCount),
    span,
    nominalIntervalSeconds,
  });
}

/** How far the baseline signal moved on its own, which is what a relative tolerance is relative to. */
export const rangeWidth = (statistics: SignalStatistics): number =>
  statistics.range === null ? 0 : statistics.range.max - statistics.range.min;

/** The window both signals cover, or null when they never overlap. */
export function overlapOf(a: TimeWindow | null, b: TimeWindow | null): TimeWindow | null {
  if (a === null || b === null) {
    return null;
  }
  const startSeconds = Math.max(a.startSeconds, b.startSeconds);
  const endSeconds = Math.min(a.endSeconds, b.endSeconds);
  return startSeconds > endSeconds ? null : { startSeconds, endSeconds };
}
