/**
 * Invariant tests for the canonical model validator.
 *
 * Traceability: 02_CANONICAL_DATA_MODEL.md §3 defines invariants 1-6; 05_IMPLEMENTATION_ROADMAP.md
 * Phase A acceptance requires one test per invariant. Each `describe` below names the invariant it
 * covers so a failing test points straight at the clause it enforces.
 *
 * These fixtures are deliberately hand-built plain objects rather than `@pandalog/core-domain`
 * constructors: the point is to construct datasets that violate the contract, which the
 * constructors are designed to make impossible.
 */
import { describe, expect, it } from 'vitest';

import {
  SCHEMA_VERSION,
  Validity,
  validateCanonicalFlightDataset,
  type CanonicalFlightDataset,
  type Sample,
  type Signal,
  type SourceProvenance,
  type TimeBase,
  type ValidationIssueCode,
  type ValidationResult,
  type Vehicle,
} from '@pandalog/schema';

const SHA256_ZERO = '0'.repeat(64);

function makeTimeBase(over: Partial<TimeBase> = {}): TimeBase {
  return Object.freeze({
    origin: 'BOOT',
    epochUtc: null,
    syncUncertaintySeconds: null,
    uniformlySampled: false,
    ...over,
  });
}

function makeProvenance(over: Partial<SourceProvenance> = {}): SourceProvenance {
  return Object.freeze({
    fileName: 'synthetic.bin',
    sha256: SHA256_ZERO,
    sizeBytes: 1024,
    format: 'synthetic',
    parserPackage: '@pandalog/schema-test',
    parserVersion: '0.1.0',
    ingestedAtUtc: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return Object.freeze({
    frameClass: null,
    firmwareVersion: null,
    firmwareHash: null,
    ...over,
  });
}

function makeSample(t: number, value: number, validity: Validity): Sample {
  return Object.freeze({ t_rel_seconds: t, value, validity });
}

function makeSignal(over: Partial<Signal> = {}): Signal {
  return Object.freeze({
    id: 'attitude.roll',
    unit: 'rad',
    sourceUnit: 'cdeg',
    timeBase: makeTimeBase(),
    samples: Object.freeze([makeSample(0, 0.1, Validity.VALID)]),
    derived: false,
    ...over,
  });
}

function makeDataset(over: Partial<CanonicalFlightDataset> = {}): CanonicalFlightDataset {
  const signals = over.signals ?? new Map<string, Signal>([['attitude.roll', makeSignal()]]);
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    provenance: makeProvenance(),
    vehicle: makeVehicle(),
    timeBase: makeTimeBase(),
    signals,
    sourceEvents: Object.freeze([]),
    ...over,
  });
}

/** Build a dataset whose single signal is `makeSignal(over)`. */
function datasetWithSignal(over: Partial<Signal>): CanonicalFlightDataset {
  const signal = makeSignal(over);
  return makeDataset({ signals: new Map([[signal.id, signal]]) });
}

function codesOf(result: ValidationResult): ValidationIssueCode[] {
  return result.issues.map((issue) => issue.code);
}

describe('validateCanonicalFlightDataset', () => {
  it('accepts a well-formed dataset', () => {
    const result = validateCanonicalFlightDataset(makeDataset());

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a non-object dataset without throwing', () => {
    for (const input of [null, undefined, 42, 'dataset', []]) {
      const result = validateCanonicalFlightDataset(input);
      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('DATASET_NOT_OBJECT');
    }
  });

  it('reports every issue rather than stopping at the first', () => {
    const bad = datasetWithSignal({
      unit: 'furlongs' as Signal['unit'],
      samples: Object.freeze([makeSample(0, 1, Validity.MISSING)]),
    });

    const result = validateCanonicalFlightDataset(bad);

    expect(result.valid).toBe(false);
    expect(codesOf(result)).toContain('SIGNAL_UNIT_UNKNOWN');
    expect(codesOf(result)).toContain('VALIDITY_VALUE_MISMATCH');
  });

  // ---------------------------------------------------------------------------------------------
  // Invariant 1 — validity !== VALID  ⇒  value is NaN (doc 02 §3.1, doc 04 §1 rule 6)
  // ---------------------------------------------------------------------------------------------
  describe('invariant 1 — validity and value are paired', () => {
    it.each([Validity.MISSING, Validity.INVALID, Validity.UNSUPPORTED, Validity.INTERPOLATED])(
      'rejects a finite value paired with %s',
      (validity) => {
        const result = validateCanonicalFlightDataset(
          datasetWithSignal({ samples: Object.freeze([makeSample(0, 0, validity)]) }),
        );

        expect(result.valid).toBe(false);
        expect(codesOf(result)).toContain('VALIDITY_VALUE_MISMATCH');
      },
    );

    it('rejects NaN paired with VALID', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ samples: Object.freeze([makeSample(0, NaN, Validity.VALID)]) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('VALIDITY_VALUE_MISMATCH');
    });

    it('rejects a non-finite value paired with VALID', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ samples: Object.freeze([makeSample(0, Infinity, Validity.VALID)]) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('VALIDITY_VALUE_MISMATCH');
    });

    it('accepts NaN paired with a non-VALID validity', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ samples: Object.freeze([makeSample(0, NaN, Validity.MISSING)]) }),
      );

      expect(result.valid).toBe(true);
    });

    it('rejects a validity outside the Validity enum', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({
          samples: Object.freeze([
            { t_rel_seconds: 0, value: 1, validity: 'PROBABLY_FINE' as Validity },
          ]),
        }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SAMPLE_INVALID');
    });

    it('rejects a non-finite sample timestamp', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ samples: Object.freeze([makeSample(NaN, 1, Validity.VALID)]) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SAMPLE_INVALID');
    });

    it('names the offending sample in the issue path', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({
          samples: Object.freeze([
            makeSample(0, 0.1, Validity.VALID),
            makeSample(1, 5, Validity.MISSING),
          ]),
        }),
      );

      expect(result.issues[0]?.path).toBe('signals["attitude.roll"].samples[1]');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Invariant 2 — every numeric Signal carries a CanonicalUnit (doc 02 §3.2)
  // ---------------------------------------------------------------------------------------------
  describe('invariant 2 — canonical units', () => {
    it('rejects a unit outside CanonicalUnit', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ unit: 'deg' as Signal['unit'] }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_UNIT_UNKNOWN');
    });

    it('rejects a missing unit', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ unit: undefined as unknown as Signal['unit'] }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_UNIT_UNKNOWN');
    });

    it('rejects a sourceUnit that is neither string nor null', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ sourceUnit: 7 as unknown as string }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_INVALID');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Invariant 3 — exactly one dataset TimeBase; every Signal states its own (doc 02 §3.3)
  // ---------------------------------------------------------------------------------------------
  describe('invariant 3 — explicit time base', () => {
    it('rejects a dataset with no TimeBase', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: undefined as unknown as TimeBase }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });

    it('rejects a signal with no TimeBase', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ timeBase: undefined as unknown as TimeBase }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });

    it('rejects an unknown TimeOrigin', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: makeTimeBase({ origin: 'GPS_WEEK' as TimeBase['origin'] }) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });

    it('rejects a non-boolean uniformlySampled', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({
          timeBase: makeTimeBase({ uniformlySampled: 'yes' as unknown as boolean }),
        }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });

    it('accepts a signal whose TimeBase differs from the dataset TimeBase', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ timeBase: makeTimeBase({ origin: 'ARM' }) }),
      );

      expect(result.valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Invariant 4 — immutable after construction (doc 02 §3.4)
  //
  // Deliberately NOT checked here. Doc 02 §3 names the enforcement for this invariant as
  // "TypeScript `readonly` + architecture test forbidding mutation helpers in packages/schema" —
  // not the runtime validator. A runtime freeze check would also be misleading: `Object.freeze`
  // on a `Map` does not prevent `set`/`delete`, so it would assert less than it appears to.
  //
  // Invariant 4 is covered by:
  //   - packages/core-domain/test/dataset.test.ts  — constructed datasets/signals are frozen
  //   - tests/architecture/schema-purity.test.ts   — packages/schema exports no mutation helper
  // ---------------------------------------------------------------------------------------------

  describe('invariant 4 — structural shape the readonly types depend on', () => {
    it('rejects a samples value that is not an array', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({ samples: {} as unknown as readonly Sample[] }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_INVALID');
    });

    it('rejects a sourceEvents value that is not an array', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ sourceEvents: {} as unknown as CanonicalFlightDataset['sourceEvents'] }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SOURCE_EVENTS_INVALID');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Invariant 6 — syncUncertaintySeconds: 0 is a claim, null is the only "unknown" (doc 02 §3.6)
  // ---------------------------------------------------------------------------------------------
  describe('invariant 6 — synchronisation uncertainty', () => {
    it('accepts null (unknown)', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: makeTimeBase({ syncUncertaintySeconds: null }) }),
      );

      expect(result.valid).toBe(true);
    });

    it('accepts 0 (a provable claim)', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: makeTimeBase({ syncUncertaintySeconds: 0 }) }),
      );

      expect(result.valid).toBe(true);
    });

    it('rejects NaN, which would smuggle "unknown" past the null contract', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: makeTimeBase({ syncUncertaintySeconds: NaN }) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });

    it('rejects a negative uncertainty', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: makeTimeBase({ syncUncertaintySeconds: -1 }) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });

    it('rejects a non-ISO epochUtc', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ timeBase: makeTimeBase({ epochUtc: 'yesterday' }) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('TIMEBASE_INVALID');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Derived-signal bookkeeping (doc 02 §5)
  // ---------------------------------------------------------------------------------------------
  describe('derived signals', () => {
    it('rejects derived: true without a derivation block', () => {
      const result = validateCanonicalFlightDataset(datasetWithSignal({ derived: true }));

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('DERIVATION_MISSING');
    });

    it('rejects a derivation block on a non-derived signal', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({
          derived: false,
          derivation: Object.freeze({
            method: 'core-domain:lowpass-4hz',
            version: '1.0.0',
            inputs: Object.freeze(['attitude.roll.raw']),
          }),
        }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('DERIVATION_UNEXPECTED');
    });

    it('accepts a well-formed derived signal', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({
          id: 'attitude.roll.filtered',
          sourceUnit: null,
          derived: true,
          derivation: Object.freeze({
            method: 'core-domain:lowpass-4hz',
            version: '1.0.0',
            inputs: Object.freeze(['attitude.roll']),
          }),
        }),
      );

      expect(result.valid).toBe(true);
    });

    it('rejects a derivation with an empty inputs list', () => {
      const result = validateCanonicalFlightDataset(
        datasetWithSignal({
          derived: true,
          derivation: Object.freeze({
            method: 'core-domain:lowpass-4hz',
            version: '1.0.0',
            inputs: Object.freeze([]),
          }),
        }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_INVALID');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Structural well-formedness needed to check the invariants above
  // ---------------------------------------------------------------------------------------------
  describe('structure', () => {
    it('rejects signals that is not a Map', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ signals: {} as unknown as ReadonlyMap<string, Signal> }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNALS_NOT_MAP');
    });

    it('rejects a map key that disagrees with the signal id', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ signals: new Map([['wrong.key', makeSignal()]]) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_ID_MISMATCH');
    });

    it('rejects an empty signal id', () => {
      const signal = makeSignal({ id: '' });
      const result = validateCanonicalFlightDataset(
        makeDataset({ signals: new Map([['', signal]]) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SIGNAL_INVALID');
    });

    it('rejects a missing schemaVersion', () => {
      const result = validateCanonicalFlightDataset(makeDataset({ schemaVersion: '' }));

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SCHEMA_VERSION_INVALID');
    });

    it('rejects a non-semver schemaVersion', () => {
      const result = validateCanonicalFlightDataset(makeDataset({ schemaVersion: 'v1' }));

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SCHEMA_VERSION_INVALID');
    });

    it.each([
      ['sha256', { sha256: 'not-a-hash' }],
      ['sizeBytes', { sizeBytes: -1 }],
      ['ingestedAtUtc', { ingestedAtUtc: 'whenever' }],
      ['fileName', { fileName: '' }],
      ['parserVersion', { parserVersion: 'latest' }],
    ])('rejects malformed provenance.%s', (_field, over) => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ provenance: makeProvenance(over) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('PROVENANCE_INVALID');
    });

    it('rejects a vehicle field that is neither string nor null', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({ vehicle: makeVehicle({ frameClass: 4 as unknown as string }) }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('VEHICLE_INVALID');
    });

    it('rejects a source event with a non-finite timestamp', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({
          sourceEvents: Object.freeze([
            Object.freeze({ t_rel_seconds: Infinity, type: 'mode-change', payload: {} }),
          ]),
        }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SOURCE_EVENTS_INVALID');
    });

    it('rejects a source event with an empty type', () => {
      const result = validateCanonicalFlightDataset(
        makeDataset({
          sourceEvents: Object.freeze([Object.freeze({ t_rel_seconds: 1, type: '', payload: {} })]),
        }),
      );

      expect(result.valid).toBe(false);
      expect(codesOf(result)).toContain('SOURCE_EVENTS_INVALID');
    });
  });
});
