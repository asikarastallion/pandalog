/**
 * Comparing the signals of two flights.
 *
 * Two things are compared, and the report always says which was used:
 *
 *   `time-aligned`      — both signals resampled onto one grid over the window they share, and
 *                         differenced point by point. The strong comparison, and the only one that
 *                         can say *when* the flights diverged.
 *   `distribution-only` — the shape of each signal on its own: coverage, range, mean, RMS. Used
 *                         when the flights share no time axis, or when a signal is too sparse to
 *                         put a grid through. Weaker, and labelled so nobody reads more into it.
 *
 * Both can honestly return `SAME`, but they are not the same claim, which is why `method` sits next
 * to `verdict` rather than being an implementation detail.
 *
 * Interpolating is `@pandalog/query`'s job, not this module's (doc 04 §1 rule 7). Everything here
 * goes through `resampleSignal`, so a point with no support on either side is `MISSING` and drops
 * out of the comparison instead of being differenced against a guess.
 */
import { resampleSignal, uniformGrid, type TimeWindow } from '@pandalog/query';
import type { CanonicalFlightDataset, Signal } from '@pandalog/schema';

import {
  columnsOf,
  isValueBearingCode,
  overlapOf,
  rangeWidth,
  summariseSignal,
  type SignalStatistics,
} from './statistics.js';
import type { TimeAlignment } from './time-alignment.js';
import {
  DEFAULT_SIGNAL_TOLERANCE,
  validateTolerance,
  type ComparisonTolerance,
} from './tolerance.js';
import type { ComparisonVerdict } from './verdict.js';

/**
 * Ceiling on comparison grid size.
 *
 * A 400 Hz gyro trace over a half-hour flight is 720 000 points, and differencing at full rate
 * answers no question a coarser grid does not — the statistic reported is a maximum and an RMS,
 * both of which converge long before that. When the cap binds, the grid rate is reported alongside
 * the result so a reader can see what was actually sampled.
 */
const MAX_GRID_POINTS = 20_000;

/**
 * How far interpolation may reach, as a multiple of a signal's own mean sample interval.
 *
 * Two, so one missed sample is bridged and a real dropout is not. Derived from the signal rather
 * than fixed, because the same wall-clock gap is routine in a barometer and a hole in a gyro.
 */
const GAP_TOLERANCE_IN_INTERVALS = 2;

export type ComparisonMethod = 'time-aligned' | 'distribution-only' | 'none';

export interface AlignedDifference {
  readonly window: TimeWindow;
  readonly gridRateHz: number;
  readonly gridPoints: number;
  /** Points where *both* flights carried a usable value. Only these were differenced. */
  readonly comparedPoints: number;
  readonly maxAbsoluteDifference: number;
  readonly rmsDifference: number;
  /** `tolerance.value` × the baseline signal's own range, in the signal's canonical unit. */
  readonly toleranceAbsolute: number;
  /** When the difference first left tolerance, or null if it never did. */
  readonly firstExceedanceSeconds: number | null;
}

export interface SignalDifference {
  readonly signalId: string;
  readonly verdict: ComparisonVerdict;
  readonly method: ComparisonMethod;
  readonly reason: string;
  readonly baseline: SignalStatistics | null;
  readonly subject: SignalStatistics | null;
  /** Null whenever the point-by-point comparison did not run. */
  readonly aligned: AlignedDifference | null;
}

export interface SignalsComparison {
  readonly verdict: ComparisonVerdict;
  readonly alignment: TimeAlignment;
  /** Signals present in both flights, ordered by id (doc 03 §6). */
  readonly differences: readonly SignalDifference[];
  readonly onlyInBaseline: readonly string[];
  readonly onlyInSubject: readonly string[];
  /**
   * Signals present in both flights that could not be compared — mismatched units, disjoint
   * windows, or no usable value on either side.
   *
   * A first-class field rather than something to be recovered by filtering `differences`, because
   * a `SAME` verdict alongside a long list here is a much weaker statement than a `SAME` alongside
   * an empty one, and a reader has to be able to see that without reconstructing it.
   */
  readonly incomparable: readonly string[];
  readonly reason: string;
}

export interface SignalComparisonOptions {
  readonly signalTolerance?: ComparisonTolerance;
}

const difference = (
  signalId: string,
  verdict: ComparisonVerdict,
  method: ComparisonMethod,
  reason: string,
  baseline: SignalStatistics | null,
  subject: SignalStatistics | null,
  aligned: AlignedDifference | null = null,
): SignalDifference =>
  Object.freeze({ signalId, verdict, method, reason, baseline, subject, aligned });

/** Grid rate that resolves the coarser of the two signals without exceeding the point ceiling. */
function gridRateFor(
  baseline: SignalStatistics,
  subject: SignalStatistics,
  window: TimeWindow,
): number | null {
  const baselineInterval = baseline.nominalIntervalSeconds;
  const subjectInterval = subject.nominalIntervalSeconds;
  if (baselineInterval === null || subjectInterval === null) {
    return null;
  }

  const nativeRate = 1 / Math.max(baselineInterval, subjectInterval);
  const durationSeconds = window.endSeconds - window.startSeconds;
  if (durationSeconds <= 0) {
    return nativeRate;
  }

  const cappedRate = (MAX_GRID_POINTS - 1) / durationSeconds;
  return Math.min(nativeRate, cappedRate);
}

function differenceOnGrid(
  baselineSignal: Signal,
  subjectSignal: Signal,
  baseline: SignalStatistics,
  subject: SignalStatistics,
  window: TimeWindow,
  rateHz: number,
  toleranceAbsolute: number,
): AlignedDifference {
  const times = uniformGrid(window.startSeconds, window.endSeconds, rateHz);

  const gapOf = (statistics: SignalStatistics): number =>
    GAP_TOLERANCE_IN_INTERVALS * (statistics.nominalIntervalSeconds ?? 0);

  const baselineColumns = columnsOf(
    resampleSignal(baselineSignal, { times, maxGapSeconds: gapOf(baseline) }),
  );
  const subjectColumns = columnsOf(
    resampleSignal(subjectSignal, { times, maxGapSeconds: gapOf(subject) }),
  );

  let comparedPoints = 0;
  let maxAbsoluteDifference = 0;
  let totalSquares = 0;
  let firstExceedanceSeconds: number | null = null;

  for (let index = 0; index < times.length; index += 1) {
    if (
      !isValueBearingCode(baselineColumns.validity[index]) ||
      !isValueBearingCode(subjectColumns.validity[index])
    ) {
      continue;
    }

    const delta = (subjectColumns.values[index] ?? NaN) - (baselineColumns.values[index] ?? NaN);
    const magnitude = Math.abs(delta);

    comparedPoints += 1;
    maxAbsoluteDifference = Math.max(maxAbsoluteDifference, magnitude);
    totalSquares += delta * delta;

    if (firstExceedanceSeconds === null && magnitude > toleranceAbsolute) {
      firstExceedanceSeconds = times[index] ?? null;
    }
  }

  return Object.freeze({
    window,
    gridRateHz: rateHz,
    gridPoints: times.length,
    comparedPoints,
    maxAbsoluteDifference,
    rmsDifference: comparedPoints === 0 ? NaN : Math.sqrt(totalSquares / comparedPoints),
    toleranceAbsolute,
    firstExceedanceSeconds,
  });
}

const describeWindow = (window: TimeWindow | null): string =>
  window === null
    ? 'no samples at all'
    : `t=${window.startSeconds.toPrecision(6)}..${window.endSeconds.toPrecision(6)} s`;

/** The largest move in any summary statistic — the distribution-only comparison's whole content. */
function largestStatisticShift(baseline: SignalStatistics, subject: SignalStatistics): number {
  const pairs: readonly (readonly [number | null, number | null])[] = [
    [baseline.range?.min ?? null, subject.range?.min ?? null],
    [baseline.range?.max ?? null, subject.range?.max ?? null],
    [baseline.mean, subject.mean],
    [baseline.rms, subject.rms],
  ];

  let largest = 0;
  for (const [left, right] of pairs) {
    if (left !== null && right !== null) {
      largest = Math.max(largest, Math.abs(right - left));
    }
  }
  return largest;
}

function compareOneSignal(
  signalId: string,
  baselineSignal: Signal,
  subjectSignal: Signal,
  alignment: TimeAlignment,
  tolerance: ComparisonTolerance,
): SignalDifference {
  const baseline = summariseSignal(baselineSignal);
  const subject = summariseSignal(subjectSignal);

  if (baseline.unit !== subject.unit) {
    return difference(
      signalId,
      'INCOMPARABLE',
      'none',
      `${signalId} is in ${baseline.unit} in the baseline and ${subject.unit} in the subject. Two ` +
        'different quantities under one id cannot be differenced, and converting between them here ' +
        'would be a unit assumption outside core-domain (doc 04 §1 rule 7).',
      baseline,
      subject,
    );
  }

  if (baseline.valueBearingCount === 0 && subject.valueBearingCount === 0) {
    return difference(
      signalId,
      'INCOMPARABLE',
      'none',
      `Neither flight carried a usable value for ${signalId}, so there is nothing to compare. Two ` +
        'absences are not a match.',
      baseline,
      subject,
    );
  }

  if (baseline.valueBearingCount === 0 || subject.valueBearingCount === 0) {
    const lost = subject.valueBearingCount === 0;
    return difference(
      signalId,
      'DIFFERENT',
      'distribution-only',
      `${signalId} carries usable data in the ${lost ? 'baseline' : 'subject'} flight and none in ` +
        `the ${lost ? 'subject' : 'baseline'}. That is a change in what the flight recorded, ` +
        'reported as a difference rather than as a failure to compare.',
      baseline,
      subject,
    );
  }

  const toleranceAbsolute = tolerance.value * rangeWidth(baseline);
  const window = overlapOf(baseline.span, subject.span);
  const rateHz = window === null ? null : gridRateFor(baseline, subject, window);

  if (alignment.comparable && window === null) {
    // Both flights logged this signal, on a shared time axis, over windows that never overlap.
    // Their distributions might match, but a comparison of two disjoint stretches of flight is not
    // a comparison of the same manoeuvre, and reporting it as one would be the strongest possible
    // form of the mistake this package exists to avoid.
    return difference(
      signalId,
      'INCOMPARABLE',
      'none',
      `${signalId} covers ${describeWindow(baseline.span)} in the baseline and ` +
        `${describeWindow(subject.span)} in the subject, which do not overlap. There is no shared ` +
        'stretch of flight to compare.',
      baseline,
      subject,
    );
  }

  if (alignment.comparable && window !== null && rateHz !== null && rateHz > 0) {
    const aligned = differenceOnGrid(
      baselineSignal,
      subjectSignal,
      baseline,
      subject,
      window,
      rateHz,
      toleranceAbsolute,
    );

    if (aligned.comparedPoints === 0) {
      return difference(
        signalId,
        'INCOMPARABLE',
        'time-aligned',
        `${signalId} overlaps in time but there is no instant where both flights carried a usable ` +
          'value, so no point could be differenced.',
        baseline,
        subject,
        aligned,
      );
    }

    const exceeds = aligned.maxAbsoluteDifference > toleranceAbsolute;
    return difference(
      signalId,
      exceeds ? 'DIFFERENT' : 'SAME',
      'time-aligned',
      `${signalId} differed by at most ${aligned.maxAbsoluteDifference.toPrecision(6)} ${baseline.unit} ` +
        `over ${String(aligned.comparedPoints)} compared points, against a tolerance of ` +
        `${toleranceAbsolute.toPrecision(6)} ${baseline.unit}.`,
      baseline,
      subject,
      aligned,
    );
  }

  const shift = largestStatisticShift(baseline, subject);
  const why = alignment.comparable
    ? `${signalId} is too sparse for a comparison grid, so only its distribution was compared`
    : `${signalId} was compared by distribution only, because the flights share no time axis`;

  return difference(
    signalId,
    shift > toleranceAbsolute ? 'DIFFERENT' : 'SAME',
    'distribution-only',
    `${why}. The largest shift in coverage, range, mean or RMS was ${shift.toPrecision(6)} ` +
      `${baseline.unit}, against a tolerance of ${toleranceAbsolute.toPrecision(6)} ${baseline.unit}. ` +
      'A matching distribution does not establish that the two flights did the same thing at the ' +
      'same time.',
    baseline,
    subject,
  );
}

/**
 * The verdict for the axis as a whole, which is not the same policy as the verdict for one signal.
 *
 * A signal that could not be compared is `INCOMPARABLE` and stays that way — that is the rule this
 * package exists for. But a signal is an *element* of this axis, not an axis, and propagating one
 * element's incomparability to the whole would be its own kind of dishonesty: a flight where 47
 * signals matched point by point and 3 were never logged by either side has been compared, and
 * reporting the lot as unexaminable throws away 47 real results to describe 3 absences.
 *
 * So: a difference anywhere wins; otherwise the axis is `SAME` if anything at all was compared, and
 * `INCOMPARABLE` only when nothing was. `incomparable` carries the caveat, in the report, by name.
 */
function axisVerdict(
  differences: readonly SignalDifference[],
  presenceDiffers: boolean,
): ComparisonVerdict {
  if (presenceDiffers || differences.some((entry) => entry.verdict === 'DIFFERENT')) {
    return 'DIFFERENT';
  }
  return differences.some((entry) => entry.verdict === 'SAME') ? 'SAME' : 'INCOMPARABLE';
}

/**
 * Compare every signal the two flights have, and say which they do not share.
 *
 * Signals present on only one side are listed rather than dropped: a flight that stopped logging a
 * sensor is one of the more useful things a comparison can surface, and it is invisible to any
 * difference computed over the intersection.
 */
export function compareSignals(
  baseline: CanonicalFlightDataset,
  subject: CanonicalFlightDataset,
  alignment: TimeAlignment,
  options: SignalComparisonOptions = {},
): SignalsComparison {
  const tolerance = validateTolerance(options.signalTolerance ?? DEFAULT_SIGNAL_TOLERANCE);

  const baselineIds = new Set(baseline.signals.keys());
  const subjectIds = new Set(subject.signals.keys());

  const shared = [...baselineIds].filter((id) => subjectIds.has(id)).sort();
  const onlyInBaseline = [...baselineIds].filter((id) => !subjectIds.has(id)).sort();
  const onlyInSubject = [...subjectIds].filter((id) => !baselineIds.has(id)).sort();

  const differences = shared.map((id) => {
    const baselineSignal = baseline.signals.get(id);
    const subjectSignal = subject.signals.get(id);
    // Both are present by construction; the guard is here because a Map lookup is typed optional.
    return baselineSignal === undefined || subjectSignal === undefined
      ? difference(
          id,
          'INCOMPARABLE',
          'none',
          `${id} disappeared between lookup and use.`,
          null,
          null,
        )
      : compareOneSignal(id, baselineSignal, subjectSignal, alignment, tolerance);
  });

  const incomparable = differences
    .filter((entry) => entry.verdict === 'INCOMPARABLE')
    .map((entry) => entry.signalId);
  const compared = differences.length - incomparable.length;
  const presenceDiffers = onlyInBaseline.length > 0 || onlyInSubject.length > 0;

  const count = (method: ComparisonMethod): number =>
    differences.filter((entry) => entry.method === method).length;

  return Object.freeze({
    verdict: axisVerdict(differences, presenceDiffers),
    alignment,
    differences: Object.freeze(differences),
    onlyInBaseline: Object.freeze(onlyInBaseline),
    onlyInSubject: Object.freeze(onlyInSubject),
    incomparable: Object.freeze(incomparable),
    reason:
      `${String(shared.length)} signal(s) in both flights: ${String(count('time-aligned'))} ` +
      `compared point by point, ${String(count('distribution-only'))} by distribution only, ` +
      `${String(incomparable.length)} not comparable. ${String(compared)} signal(s) actually ` +
      `contributed to the verdict. ${String(onlyInBaseline.length)} only in the baseline, ` +
      `${String(onlyInSubject.length)} only in the subject.`,
  });
}
