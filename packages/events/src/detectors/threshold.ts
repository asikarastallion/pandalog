/**
 * Shared machinery for detectors that find *intervals* where a signal crosses a threshold.
 *
 * Two properties matter and are easy to get wrong:
 *
 * **Missing data does not close an interval, and does not open one either.** A gap in the signal is
 * an absence of evidence, not evidence of recovery. A run of MISSING samples inside an excursion
 * leaves the excursion open and records that it contains a gap, so a consumer can see the interval
 * was not continuously observed rather than being told a clean story.
 *
 * **A minimum duration is required.** Without it a single noisy sample becomes an "event", and the
 * timeline fills with occurrences that mean nothing.
 */
import { isValueBearing } from '@pandalog/query';
import type { Signal } from '@pandalog/schema';

export interface ThresholdRun {
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Extreme value reached inside the run — the peak for `above`, the trough for `below`. */
  readonly extremeValue: number;
  readonly sampleCount: number;
  /** True when the run contains samples with no usable value. */
  readonly containsGap: boolean;
}

export interface ThresholdOptions {
  readonly threshold: number;
  readonly direction: 'above' | 'below';
  /** Runs shorter than this are noise, not events. */
  readonly minDurationSeconds: number;
}

const exceeds = (value: number, options: ThresholdOptions): boolean =>
  options.direction === 'above' ? value > options.threshold : value < options.threshold;

/** Contiguous runs where the signal is on the wrong side of the threshold. */
export function findThresholdRuns(signal: Signal, options: ThresholdOptions): ThresholdRun[] {
  const runs: ThresholdRun[] = [];

  let start: number | null = null;
  let last = 0;
  let extreme = 0;
  let count = 0;
  let gap = false;

  const close = (): void => {
    if (start !== null && last - start >= options.minDurationSeconds) {
      runs.push({
        startSeconds: start,
        endSeconds: last,
        extremeValue: extreme,
        sampleCount: count,
        containsGap: gap,
      });
    }
    start = null;
    count = 0;
    gap = false;
  };

  for (const sample of signal.samples) {
    if (!isValueBearing(sample.validity)) {
      // Inside a run, a gap is recorded but does not end it: we did not observe recovery.
      if (start !== null) {
        gap = true;
      }
      continue;
    }

    if (exceeds(sample.value, options)) {
      if (start === null) {
        start = sample.t_rel_seconds;
        extreme = sample.value;
        count = 0;
      }
      extreme =
        options.direction === 'above'
          ? Math.max(extreme, sample.value)
          : Math.min(extreme, sample.value);
      last = sample.t_rel_seconds;
      count += 1;
    } else if (start !== null) {
      close();
    }
  }

  close();
  return runs;
}
