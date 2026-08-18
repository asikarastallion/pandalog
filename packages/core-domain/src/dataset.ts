/**
 * Canonical dataset construction — 02_CANONICAL_DATA_MODEL.md §2, §3 invariant 4, §7.
 *
 * The constructor is where a dataset becomes immutable and where the structural rules are enforced
 * once. It deliberately does not re-walk every sample: `createSignal` already guaranteed
 * invariants 1a/1b at the point each signal was built, and re-checking a multi-million-sample
 * dataset here would double the cost of ingestion for no additional guarantee. Ingestion still
 * runs the whole-dataset validator at the boundary (doc 02 §6), which is where genuinely untrusted
 * input arrives.
 */
import {
  SCHEMA_VERSION,
  validateProvenance,
  validateSourceEvents,
  validateTimeBase,
  validateVehicle,
  type CanonicalFlightDataset,
  type Signal,
  type SourceEvent,
  type SourceProvenance,
  type TimeBase,
  type ValidationIssue,
  type Vehicle,
} from '@pandalog/schema';

import { InvalidDatasetError } from './errors.js';
import { getSignalColumns } from './signal.js';

export interface CreateCanonicalFlightDatasetInput {
  readonly provenance: SourceProvenance;
  readonly vehicle: Vehicle;
  readonly timeBase: TimeBase;
  readonly signals: Iterable<Signal>;
  readonly sourceEvents?: Iterable<SourceEvent>;
}

function describe(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}

function freezeSourceEvent(event: SourceEvent): SourceEvent {
  return Object.freeze({
    t_rel_seconds: event.t_rel_seconds,
    type: event.type,
    payload: Object.freeze({ ...event.payload }),
  });
}

/**
 * Build a validated, immutable `CanonicalFlightDataset`.
 *
 * Every nested structure is frozen and every caller-supplied container is copied, so a caller that
 * keeps a reference to what it passed in cannot mutate the dataset afterwards.
 *
 * @throws {InvalidDatasetError} on malformed provenance/vehicle/time base/source events, or on
 * duplicate signal ids — which a `Map` would otherwise silently collapse to one entry.
 */
export function createCanonicalFlightDataset(
  input: CreateCanonicalFlightDatasetInput,
): CanonicalFlightDataset {
  const provenance = Object.freeze({ ...input.provenance });
  const vehicle = Object.freeze({ ...input.vehicle });
  const sourceEvents = Object.freeze([...(input.sourceEvents ?? [])].map(freezeSourceEvent));

  const issues: ValidationIssue[] = [
    ...validateProvenance(provenance),
    ...validateVehicle(vehicle),
    ...validateTimeBase(input.timeBase),
    ...validateSourceEvents(sourceEvents),
  ];

  if (issues.length > 0) {
    throw new InvalidDatasetError(`Cannot construct a dataset: ${describe(issues)}`, { issues });
  }

  const signals = new Map<string, Signal>();
  for (const signal of input.signals) {
    if (signals.has(signal.id)) {
      throw new InvalidDatasetError(
        `Duplicate signal id ${JSON.stringify(signal.id)}. Storing signals by id would silently ` +
          'discard one of them; the caller must resolve the collision explicitly.',
        { signalId: signal.id },
      );
    }
    signals.set(signal.id, signal);
  }

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    provenance,
    vehicle,
    timeBase: input.timeBase,
    signals,
    sourceEvents,
  });
}

export interface DatasetTimeSpan {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/**
 * The extent of a dataset on its own time axis — the earliest and latest sample any signal carries.
 *
 * Selection, not calculation: both numbers are timestamps the log recorded. It lives here rather
 * than in a consumer because three of them need it (the workspace, to place a finding against the
 * whole flight; `@pandalog/reporting`, to bound the last mode interval; anything charting a flight)
 * and three implementations of "when did this flight start" would eventually disagree.
 *
 * Returns null when no signal carries a sample. Null rather than a zero-width window at the origin:
 * a flight with no time extent is not a flight that happened at t = 0.
 */
export function datasetTimeSpan(dataset: CanonicalFlightDataset): DatasetTimeSpan | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const signal of dataset.signals.values()) {
    const columns = getSignalColumns(signal);
    const length = columns?.t.length ?? signal.samples.length;
    if (length === 0) {
      continue;
    }
    const first = columns?.t[0] ?? signal.samples[0]?.t_rel_seconds;
    const last = columns?.t[length - 1] ?? signal.samples[length - 1]?.t_rel_seconds;
    if (first === undefined || last === undefined) {
      continue;
    }
    start = Math.min(start, first);
    end = Math.max(end, last);
  }

  return Number.isFinite(start) && Number.isFinite(end)
    ? { startSeconds: start, endSeconds: end }
    : null;
}
