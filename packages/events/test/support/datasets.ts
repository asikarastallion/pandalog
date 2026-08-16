/** Synthetic dataset builders for detector tests. */
import { createCanonicalFlightDataset, createSignal, createTimeBase } from '@pandalog/core-domain';
import {
  Validity,
  type CanonicalFlightDataset,
  type Sample,
  type Signal,
  type SourceEvent,
} from '@pandalog/schema';

export const timeBase = createTimeBase({ origin: 'BOOT' });

export const valid = (t: number, value: number): Sample => ({
  t_rel_seconds: t,
  value,
  validity: Validity.VALID,
});

export const missing = (t: number): Sample => ({
  t_rel_seconds: t,
  value: NaN,
  validity: Validity.MISSING,
});

export const unsupported = (t: number): Sample => ({
  t_rel_seconds: t,
  value: NaN,
  validity: Validity.UNSUPPORTED,
});

export function signalOf(
  id: string,
  samples: Sample[],
  unit: 'unitless' | 'm/s^2' | 'count' = 'unitless',
): Signal {
  return createSignal({ id, unit, sourceUnit: null, timeBase, samples });
}

/** Signal sampled at a fixed rate from a list of values. */
export function series(
  id: string,
  values: readonly (number | null)[],
  stepSeconds = 0.1,
  unit: 'unitless' | 'm/s^2' | 'count' = 'unitless',
): Signal {
  return signalOf(
    id,
    values.map((value, index) =>
      value === null ? missing(index * stepSeconds) : valid(index * stepSeconds, value),
    ),
    unit,
  );
}

export function datasetOf(
  signals: Signal[],
  sourceEvents: SourceEvent[] = [],
): CanonicalFlightDataset {
  return createCanonicalFlightDataset({
    provenance: {
      fileName: 'synthetic.bin',
      sha256: 'c'.repeat(64),
      sizeBytes: 128,
      format: 'synthetic',
      parserPackage: '@pandalog/events-test',
      parserVersion: '0.1.0',
      ingestedAtUtc: '2026-01-01T00:00:00.000Z',
    },
    vehicle: { frameClass: null, firmwareVersion: null, firmwareHash: null },
    timeBase,
    signals,
    sourceEvents,
  });
}
