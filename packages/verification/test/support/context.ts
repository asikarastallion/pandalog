/** Synthetic contexts for requirement tests. */
import { createFinding, type EvidenceRef, type Finding } from '@pandalog/analysis';
import { createCanonicalFlightDataset, createSignal, createTimeBase } from '@pandalog/core-domain';
import { createFlightEvent, type FlightEvent } from '@pandalog/events';
import {
  Validity,
  type CanonicalFlightDataset,
  type CanonicalUnit,
  type Sample,
  type Signal,
  type SourceEvent,
} from '@pandalog/schema';

import type { RequirementContext } from '@pandalog/verification';

const timeBase = createTimeBase({ origin: 'BOOT' });

const PROVENANCE = {
  fileName: 'synthetic.bin',
  sha256: 'e'.repeat(64),
  sizeBytes: 512,
  format: 'synthetic',
  parserPackage: '@pandalog/verification-test',
  parserVersion: '0.1.0',
  ingestedAtUtc: '2026-01-01T00:00:00.000Z',
};

export const NOW = '2026-01-01T00:00:00.000Z';
export const now = (): Date => new Date(NOW);

const SAMPLE_COUNT = 100;
const SAMPLE_PERIOD_SECONDS = 0.1;

export interface SignalSpec {
  readonly id: string;
  readonly unit?: CanonicalUnit;
  readonly value?: number;
  /** When true the signal exists but carries nothing usable — the withheld-evidence case. */
  readonly allMissing?: boolean;
}

function buildSignal(spec: SignalSpec): Signal {
  const samples: Sample[] = Array.from({ length: SAMPLE_COUNT }, (_unused, index) =>
    spec.allMissing === true
      ? { t_rel_seconds: index * SAMPLE_PERIOD_SECONDS, value: NaN, validity: Validity.MISSING }
      : {
          t_rel_seconds: index * SAMPLE_PERIOD_SECONDS,
          value: spec.value ?? 1,
          validity: Validity.VALID,
        },
  );

  return createSignal({
    id: spec.id,
    unit: spec.unit ?? 'unitless',
    sourceUnit: null,
    timeBase,
    samples,
  });
}

export function datasetOf(
  specs: readonly (SignalSpec | string)[],
  sourceEvents: readonly SourceEvent[] = [],
): CanonicalFlightDataset {
  return createCanonicalFlightDataset({
    provenance: PROVENANCE,
    vehicle: { frameClass: 'quad', firmwareVersion: '4.5.0', firmwareHash: null },
    timeBase,
    signals: specs.map((spec) => buildSignal(typeof spec === 'string' ? { id: spec } : spec)),
    sourceEvents,
  });
}

export const ATTITUDE_SIGNALS: readonly string[] = [
  'attitude.roll',
  'attitude.roll.desired',
  'attitude.pitch',
  'attitude.pitch.desired',
];

export const VIBRATION_SIGNALS: readonly string[] = ['vibration.x', 'vibration.y', 'vibration.z'];

/** Every signal the provisional requirement set knows how to look at. */
export const ALL_SIGNALS: readonly string[] = [
  ...ATTITUDE_SIGNALS,
  ...VIBRATION_SIGNALS,
  'gps.fix_type',
];

export function event(overrides: {
  readonly id: string;
  readonly type: string;
  readonly t_start_seconds?: number;
  readonly t_end_seconds?: number | null;
  readonly sourceSignalIds?: readonly string[];
  readonly payload?: Readonly<Record<string, unknown>>;
}): FlightEvent {
  return createFlightEvent({
    id: overrides.id,
    type: overrides.type,
    t_start_seconds: overrides.t_start_seconds ?? 1,
    t_end_seconds: overrides.t_end_seconds ?? null,
    sourceSignalIds: overrides.sourceSignalIds ?? [],
    detector: { name: 'test:detector', version: '1.0.0' },
    payload: overrides.payload ?? { source: 'test' },
  });
}

/** An event standing in for a record the log itself carried (mode change, error, message). */
export function loggedRecord(id: string, type: string, t_start_seconds: number): FlightEvent {
  return event({
    id,
    type,
    t_start_seconds,
    payload: { source: `sourceEvent:${type}` },
  });
}

export function finding(ruleId: string, evidence?: readonly EvidenceRef[]): Finding {
  return createFinding({
    id: `${ruleId}#0`,
    ruleId,
    ruleVersion: '1.0.0',
    statement: `${ruleId} produced a finding`,
    severity: 'WARNING',
    evidence: evidence ?? [{ kind: 'event', eventId: 'e1' }],
    producedAtUtc: NOW,
  });
}

export function contextOf(options: {
  readonly dataset?: CanonicalFlightDataset;
  readonly events?: readonly FlightEvent[];
  readonly findings?: readonly Finding[];
}): RequirementContext {
  return {
    dataset: options.dataset ?? datasetOf(ALL_SIGNALS),
    events: options.events ?? [],
    findings: options.findings ?? [],
    now,
  };
}
