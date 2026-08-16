/**
 * Detector contract and registry — 05_IMPLEMENTATION_ROADMAP.md Phase D.
 *
 * Mirrors the adapter pattern deliberately: `Adapter -> Canonical` becomes `Detector -> FlightEvent`.
 * A new kind of event is a new detector, registered alongside the others; it is never a branch
 * added inside an existing one.
 *
 * Registries are immutable — `withDetector` returns a new one — so a registry handed to a caller
 * cannot change underneath it.
 */
import type { CanonicalFlightDataset } from '@pandalog/schema';

import { EventsError } from './errors.js';
import type { DetectorIdentity, FlightEvent } from './event.js';

export interface DetectorContext {
  readonly dataset: CanonicalFlightDataset;
}

export interface EventDetector extends DetectorIdentity {
  /**
   * Detect events. Must be deterministic: the same dataset yields byte-identical events, including
   * their ids and ordering (doc 03 §6).
   *
   * A detector that finds nothing returns an empty array. It never throws for absent data — a
   * signal it needs being missing is a normal condition, not an error, and is reported by simply
   * finding nothing.
   */
  detect(context: DetectorContext): FlightEvent[];
}

export interface DetectorRegistry {
  readonly detectors: readonly EventDetector[];
  get(name: string): EventDetector | null;
  withDetector(detector: EventDetector): DetectorRegistry;
}

function build(detectors: readonly EventDetector[]): DetectorRegistry {
  const frozen = Object.freeze([...detectors]);
  return Object.freeze({
    detectors: frozen,
    get: (name: string) => frozen.find((detector) => detector.name === name) ?? null,
    withDetector(detector: EventDetector): DetectorRegistry {
      if (detector.name.length === 0) {
        throw new EventsError('INVALID_DETECTOR_CONFIG', 'A detector must declare a name.');
      }
      if (frozen.some((existing) => existing.name === detector.name)) {
        throw new EventsError(
          'DUPLICATE_DETECTOR',
          `A detector named ${JSON.stringify(detector.name)} is already registered; events would ` +
            'be ambiguous about which implementation produced them.',
          { name: detector.name },
        );
      }
      return build([...frozen, detector]);
    },
  });
}

export function createDetectorRegistry(detectors: Iterable<EventDetector> = []): DetectorRegistry {
  let registry = build([]);
  for (const detector of detectors) {
    registry = registry.withDetector(detector);
  }
  return registry;
}

/**
 * Run every detector and return their events in a stable order.
 *
 * Sorted by start time, then type, then id — so two runs over one dataset produce the same
 * sequence regardless of registration order, which is what lets a report be diffed meaningfully.
 */
export function detectEvents(registry: DetectorRegistry, context: DetectorContext): FlightEvent[] {
  const events = registry.detectors.flatMap((detector) => detector.detect(context));

  return events.sort(
    (a, b) =>
      a.t_start_seconds - b.t_start_seconds ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id),
  );
}
