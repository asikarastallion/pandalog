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
