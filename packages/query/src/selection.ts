/**
 * Signal selection — 05_IMPLEMENTATION_ROADMAP.md Phase C.
 *
 * Selection is read-only and never mutates the dataset (doc 02 §3 invariant 4). `sliceByTime`
 * returns a new `Signal` built through core-domain's constructor, so a windowed view obeys the
 * same invariants as the signal it came from.
 */
import { createSignal, getSignalColumns } from '@pandalog/core-domain';
import { Validity, type CanonicalFlightDataset, type Sample, type Signal } from '@pandalog/schema';

export interface TimeWindow {
  /** Inclusive lower bound, in the signal's own t_rel_seconds. */
  readonly startSeconds: number;
  /** Inclusive upper bound. */
  readonly endSeconds: number;
}

export function selectSignal(dataset: CanonicalFlightDataset, id: string): Signal | null {
  return dataset.signals.get(id) ?? null;
}

/**
 * Match signal ids against a glob pattern where `*` matches any run of characters within a
 * segment and `**` crosses segment boundaries — e.g. `attitude.*`, `*.roll`, `imu.**`.
 *
 * Patterns are matched against the whole id, so `attitude` does not match `attitude.roll`; that
 * ambiguity is how a query silently returns the wrong set.
 */
export function matchesPattern(id: string, pattern: string): boolean {
  let expression = '';
  let index = 0;

  while (index < pattern.length) {
    if (pattern.startsWith('**', index)) {
      expression += '.*';
      index += 2;
      continue;
    }
    const char = pattern[index] ?? '';
    // Built by walking the pattern rather than by substituting placeholders: a placeholder that
    // can appear in a real signal id silently changes what the query matches.
    expression += char === '*' ? '[^.]*' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }

  return new RegExp(`^${expression}$`).test(id);
}

/** Every signal whose id matches the pattern, in stable id order. */
export function selectSignals(dataset: CanonicalFlightDataset, pattern: string): Signal[] {
  return [...dataset.signals.values()]
    .filter((signal) => matchesPattern(signal.id, pattern))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The time span a signal actually covers, or null when it has no samples. */
export function timeSpanOf(signal: Signal): TimeWindow | null {
  const columns = getSignalColumns(signal);
  const length = columns?.t.length ?? signal.samples.length;
  if (length === 0) {
    return null;
  }
  const first = columns?.t[0] ?? signal.samples[0]?.t_rel_seconds;
  const last = columns?.t[length - 1] ?? signal.samples[length - 1]?.t_rel_seconds;
  return first === undefined || last === undefined
    ? null
    : { startSeconds: first, endSeconds: last };
}

/**
 * A new signal containing only the samples inside the window.
 *
 * The window is inclusive at both ends so an evidence reference naming `[t_start, t_end]` resolves
 * to the samples an engineer would expect to see when they open it (doc 03 §5).
 */
export function sliceByTime(signal: Signal, window: TimeWindow): Signal {
  const samples: Sample[] = [];
  for (const sample of signal.samples) {
    if (sample.t_rel_seconds >= window.startSeconds && sample.t_rel_seconds <= window.endSeconds) {
      samples.push(sample);
    }
  }

  return createSignal({
    id: signal.id,
    unit: signal.unit,
    sourceUnit: signal.sourceUnit,
    timeBase: signal.timeBase,
    samples,
    derived: signal.derived,
    ...(signal.derivation === undefined ? {} : { derivation: signal.derivation }),
  });
}

/** Samples carrying a usable number (doc 02 §3 invariant 1a, ADR-0007). */
export function valueBearingSamples(signal: Signal): Sample[] {
  return signal.samples.filter(
    (sample) => sample.validity === Validity.VALID || sample.validity === Validity.INTERPOLATED,
  );
}
