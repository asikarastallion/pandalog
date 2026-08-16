/**
 * Multi-signal alignment — 05_IMPLEMENTATION_ROADMAP.md Phase C acceptance.
 *
 * > Two signals with different `TimeBase.origin` cannot be silently aligned without the query
 * > surfacing the `syncUncertaintySeconds` used.
 *
 * So alignment always reports the uncertainty it relied on, and refuses when it cannot state one:
 *
 *   same origin      — one clock, so the uncertainty *between* them is 0. A real claim, not a
 *                      placeholder: samples from one boot clock share a timebase exactly.
 *   differing origin — only possible when both sides declare a `syncUncertaintySeconds`. The
 *                      combined figure is the quadrature sum, treating the two as independent
 *                      one-sigma estimates.
 *   otherwise        — UNKNOWN_SYNCHRONISATION. Correlating a control input with a sensor response
 *                      across clocks of unknown offset produces a lag that is an artefact, and a
 *                      finding built on it would be wrong in a way nothing downstream could detect.
 */
import { Validity, type Signal, type TimeBase } from '@pandalog/schema';

import { QueryError } from './errors.js';
import { resampleSignal, type ResampleOptions } from './resample.js';
import { timeSpanOf } from './selection.js';

export interface AlignmentResult {
  /** The common grid every returned signal is sampled on. */
  readonly times: Float64Array;
  /** Input signals resampled onto `times`, in the order given. */
  readonly signals: readonly Signal[];
  /** Time base the aligned series is expressed in — the first input's. */
  readonly timeBase: TimeBase;
  /**
   * One-sigma uncertainty, in seconds, of the alignment itself. Always reported so a consumer can
   * decide whether a correlation is meaningful at the timescale it cares about.
   */
  readonly syncUncertaintySeconds: number;
  /** True when the inputs did not share a time origin. */
  readonly originsDiffer: boolean;
}

export type AlignOptions = ResampleOptions;

/**
 * Combine independent one-sigma estimates in quadrature.
 *
 * Quadrature rather than a plain sum because the two clock offsets are independent errors, and
 * summing would overstate the combined uncertainty — which sounds conservative but makes every
 * cross-clock correlation look worthless.
 */
function combineUncertainty(values: readonly number[]): number {
  return Math.sqrt(values.reduce((total, value) => total + value * value, 0));
}

function resolveSynchronisation(signals: readonly Signal[]): {
  syncUncertaintySeconds: number;
  originsDiffer: boolean;
} {
  const origins = new Set(signals.map((signal) => signal.timeBase.origin));
  if (origins.size <= 1) {
    return { syncUncertaintySeconds: 0, originsDiffer: false };
  }

  const uncertainties: number[] = [];
  for (const signal of signals) {
    const uncertainty = signal.timeBase.syncUncertaintySeconds;
    if (uncertainty === null) {
      throw new QueryError(
        'UNKNOWN_SYNCHRONISATION',
        `Cannot align ${signal.id}: its time base has origin ${signal.timeBase.origin} while other ` +
          `inputs use ${[...origins].filter((origin) => origin !== signal.timeBase.origin).join(', ')}, ` +
          'and its syncUncertaintySeconds is null. Aligning across clocks whose offset is unknown ' +
          'would produce a lag that is an artefact of the alignment rather than of the vehicle.',
        { signalId: signal.id, origins: [...origins] },
      );
    }
    uncertainties.push(uncertainty);
  }

  return { syncUncertaintySeconds: combineUncertainty(uncertainties), originsDiffer: true };
}

/**
 * Resample several signals onto one grid.
 *
 * @throws {QueryError} UNKNOWN_SYNCHRONISATION when origins differ and any input's synchronisation
 * uncertainty is unstated.
 */
export function alignSignals(signals: readonly Signal[], options: AlignOptions): AlignmentResult {
  const [first] = signals;
  if (first === undefined) {
    throw new QueryError('INVALID_GRID', 'alignSignals requires at least one signal.', {});
  }

  const synchronisation = resolveSynchronisation(signals);
  const times = Float64Array.from(options.times);

  return {
    times,
    signals: signals.map((signal) => resampleSignal(signal, options)),
    timeBase: first.timeBase,
    syncUncertaintySeconds: synchronisation.syncUncertaintySeconds,
    originsDiffer: synchronisation.originsDiffer,
  };
}

/**
 * The time span every signal covers, or null when they never overlap.
 *
 * Useful for choosing a grid that does not consist mostly of MISSING.
 */
export function commonTimeSpan(
  signals: readonly Signal[],
): { startSeconds: number; endSeconds: number } | null {
  let start = Number.NEGATIVE_INFINITY;
  let end = Number.POSITIVE_INFINITY;

  for (const signal of signals) {
    const span = timeSpanOf(signal);
    if (span === null) {
      return null;
    }
    start = Math.max(start, span.startSeconds);
    end = Math.min(end, span.endSeconds);
  }

  return start > end || !Number.isFinite(start) || !Number.isFinite(end)
    ? null
    : { startSeconds: start, endSeconds: end };
}

/** True when a sample carries a usable number (doc 02 §3 invariant 1a). */
export function isValueBearing(validity: Validity): boolean {
  return validity === Validity.VALID || validity === Validity.INTERPOLATED;
}
