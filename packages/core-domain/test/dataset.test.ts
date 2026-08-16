/**
 * Canonical dataset construction — 02_CANONICAL_DATA_MODEL.md §2, §3 invariant 4, §7.
 *
 * This file also carries invariant 4's coverage. Doc 02 §3 assigns immutability to the `readonly`
 * types plus an architecture test rather than to the runtime validator, so the guarantee is pinned
 * where it is actually produced: the construction path.
 */
import { describe, expect, it } from 'vitest';

import {
  createCanonicalFlightDataset,
  createSignal,
  createTimeBase,
  InvalidDatasetError,
} from '@pandalog/core-domain';
import { SCHEMA_VERSION, validateCanonicalFlightDataset, Validity } from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });

const provenance = {
  fileName: 'synthetic.bin',
  sha256: 'a'.repeat(64),
  sizeBytes: 2048,
  format: 'synthetic',
  parserPackage: '@pandalog/core-domain-test',
  parserVersion: '0.1.0',
  ingestedAtUtc: '2026-01-01T00:00:00.000Z',
};

const noVehicle = { frameClass: null, firmwareVersion: null, firmwareHash: null };

const roll = () =>
  createSignal({
    id: 'attitude.roll',
    unit: 'rad',
    sourceUnit: 'cdeg',
    timeBase,
    samples: [{ t_rel_seconds: 0, value: 0.1, validity: Validity.VALID }],
  });

function nominalDataset() {
  return createCanonicalFlightDataset({
    provenance,
    vehicle: { frameClass: 'quad', firmwareVersion: '4.5.0', firmwareHash: null },
    timeBase,
    signals: [roll()],
  });
}

describe('createCanonicalFlightDataset', () => {
  it('produces a dataset the schema validator accepts', () => {
    const result = validateCanonicalFlightDataset(nominalDataset());

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('stamps the current schema version', () => {
    expect(nominalDataset().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keys the signal map by signal id', () => {
    const dataset = nominalDataset();

    expect([...dataset.signals.keys()]).toEqual(['attitude.roll']);
    expect(dataset.signals.get('attitude.roll')?.unit).toBe('rad');
  });

  it('defaults sourceEvents to empty rather than omitting the field', () => {
    expect(nominalDataset().sourceEvents).toEqual([]);
  });

  it('carries source events through in order', () => {
    const dataset = createCanonicalFlightDataset({
      provenance,
      vehicle: noVehicle,
      timeBase,
      signals: [roll()],
      sourceEvents: [
        { t_rel_seconds: 1, type: 'mode-change', payload: { to: 'LOITER' } },
        { t_rel_seconds: 2, type: 'error', payload: { subsystem: 'GPS' } },
      ],
    });

    expect(dataset.sourceEvents.map((event) => event.type)).toEqual(['mode-change', 'error']);
  });

  describe('invariant 4 — immutable after construction', () => {
    it('freezes the dataset', () => {
      expect(Object.isFrozen(nominalDataset())).toBe(true);
    });

    it('freezes each signal', () => {
      expect(Object.isFrozen(nominalDataset().signals.get('attitude.roll'))).toBe(true);
    });

    it('freezes provenance, vehicle and the time base', () => {
      const dataset = nominalDataset();

      expect(Object.isFrozen(dataset.provenance)).toBe(true);
      expect(Object.isFrozen(dataset.vehicle)).toBe(true);
      expect(Object.isFrozen(dataset.timeBase)).toBe(true);
    });

    it('freezes source events and their payloads', () => {
      const dataset = createCanonicalFlightDataset({
        provenance,
        vehicle: noVehicle,
        timeBase,
        signals: [roll()],
        sourceEvents: [{ t_rel_seconds: 1, type: 'mode-change', payload: { to: 'LOITER' } }],
      });

      expect(Object.isFrozen(dataset.sourceEvents)).toBe(true);
      expect(Object.isFrozen(dataset.sourceEvents[0])).toBe(true);
      expect(Object.isFrozen(dataset.sourceEvents[0]?.payload)).toBe(true);
    });

    it('does not alias the caller-supplied provenance object', () => {
      const mutableProvenance = { ...provenance };
      const dataset = createCanonicalFlightDataset({
        provenance: mutableProvenance,
        vehicle: noVehicle,
        timeBase,
        signals: [roll()],
      });

      mutableProvenance.fileName = 'swapped.bin';

      expect(dataset.provenance.fileName).toBe('synthetic.bin');
    });

    it('does not alias the caller-supplied signal list', () => {
      const signals = [roll()];
      const dataset = createCanonicalFlightDataset({
        provenance,
        vehicle: noVehicle,
        timeBase,
        signals,
      });

      signals.length = 0;

      expect(dataset.signals.size).toBe(1);
    });
  });

  describe('fails loudly on malformed input', () => {
    it('rejects duplicate signal ids rather than silently dropping one', () => {
      expect(() =>
        createCanonicalFlightDataset({
          provenance,
          vehicle: noVehicle,
          timeBase,
          signals: [roll(), roll()],
        }),
      ).toThrow(InvalidDatasetError);
    });

    it('rejects malformed provenance', () => {
      expect(() =>
        createCanonicalFlightDataset({
          provenance: { ...provenance, sha256: 'not-a-hash' },
          vehicle: noVehicle,
          timeBase,
          signals: [roll()],
        }),
      ).toThrow(InvalidDatasetError);
    });

    it('rejects a negative file size', () => {
      expect(() =>
        createCanonicalFlightDataset({
          provenance: { ...provenance, sizeBytes: -1 },
          vehicle: noVehicle,
          timeBase,
          signals: [roll()],
        }),
      ).toThrow(InvalidDatasetError);
    });

    it('rejects a source event with a non-finite timestamp', () => {
      expect(() =>
        createCanonicalFlightDataset({
          provenance,
          vehicle: noVehicle,
          timeBase,
          signals: [roll()],
          sourceEvents: [{ t_rel_seconds: NaN, type: 'mode-change', payload: {} }],
        }),
      ).toThrow(InvalidDatasetError);
    });

    it('carries a structured error code', () => {
      try {
        createCanonicalFlightDataset({
          provenance,
          vehicle: noVehicle,
          timeBase,
          signals: [roll(), roll()],
        });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as InvalidDatasetError).code).toBe('INVALID_DATASET');
      }
    });
  });
});
