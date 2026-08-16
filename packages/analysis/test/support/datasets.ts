/** Synthetic datasets for rule tests. */
import { createCanonicalFlightDataset, createSignal, createTimeBase } from '@pandalog/core-domain';
import {
  Validity,
  type CanonicalFlightDataset,
  type CanonicalUnit,
  type Sample,
  type Signal,
} from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });

const PROVENANCE = {
  fileName: 'synthetic.bin',
  sha256: 'd'.repeat(64),
  sizeBytes: 256,
  format: 'synthetic',
  parserPackage: '@pandalog/analysis-test',
  parserVersion: '0.1.0',
  ingestedAtUtc: '2026-01-01T00:00:00.000Z',
};

function build(signals: Signal[]): CanonicalFlightDataset {
  return createCanonicalFlightDataset({
    provenance: PROVENANCE,
    vehicle: { frameClass: 'quad', firmwareVersion: '4.5.0', firmwareHash: null },
    timeBase,
    signals,
  });
}

function constantSignal(id: string, value: number, unit: CanonicalUnit, count = 100): Signal {
  const samples: Sample[] = Array.from({ length: count }, (_unused, index) => ({
    t_rel_seconds: index * 0.1,
    value,
    validity: Validity.VALID,
  }));
  return createSignal({ id, unit, sourceUnit: null, timeBase, samples });
}

export const emptyDataset = (): CanonicalFlightDataset => build([]);

/** A dataset carrying the named signals with placeholder content. */
export const datasetOf = (ids: string[]): CanonicalFlightDataset =>
  build(ids.map((id) => constantSignal(id, 3, 'unitless')));

/** Attitude with a constant tracking error of `errorRad` between desired and actual. */
export function attitudeDataset(options: {
  errorRad: number;
  allMissing?: boolean;
}): CanonicalFlightDataset {
  const count = 100;
  const make = (id: string, value: number): Signal =>
    createSignal({
      id,
      unit: 'rad',
      sourceUnit: null,
      timeBase,
      samples: Array.from({ length: count }, (_unused, index) =>
        options.allMissing === true
          ? { t_rel_seconds: index * 0.1, value: NaN, validity: Validity.MISSING }
          : { t_rel_seconds: index * 0.1, value, validity: Validity.VALID },
      ),
    });

  return build([
    make('attitude.roll', 0),
    make('attitude.roll.desired', options.errorRad),
    make('attitude.pitch', 0),
    make('attitude.pitch.desired', 0),
  ]);
}

/** Three-axis vibration, plus any extra signals a rule needs to be applicable. */
export function vibrationDataset(extraIds: string[] = []): CanonicalFlightDataset {
  return build([
    constantSignal('vibration.x', 5, 'm/s^2'),
    constantSignal('vibration.y', 5, 'm/s^2'),
    constantSignal('vibration.z', 5, 'm/s^2'),
    ...extraIds.map((id) => constantSignal(id, 3, 'unitless')),
  ]);
}
