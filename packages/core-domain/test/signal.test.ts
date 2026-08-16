/**
 * Signal construction and typed-array storage — 02_CANONICAL_DATA_MODEL.md §2, §4 and §5.
 *
 * `Signal.samples` is the logical shape; the storage underneath is parallel typed arrays. These
 * tests pin both halves of that contract: the view must behave like a real `readonly Sample[]`,
 * and the columns must remain the single representation of the numbers.
 */
import { describe, expect, it } from 'vitest';

import {
  createSignal,
  createSignalFromColumns,
  createTimeBase,
  getSignalColumns,
  InvalidSignalError,
  validityFromCode,
  VALIDITY_CODES,
} from '@pandalog/core-domain';
import { Validity, type Sample } from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });

function nominalSamples(): Sample[] {
  return [
    { t_rel_seconds: 0, value: 0.1, validity: Validity.VALID },
    { t_rel_seconds: 0.5, value: NaN, validity: Validity.MISSING },
    { t_rel_seconds: 1, value: 0.3, validity: Validity.VALID },
  ];
}

function nominalSignal() {
  return createSignal({
    id: 'attitude.roll',
    unit: 'rad',
    sourceUnit: 'cdeg',
    timeBase,
    samples: nominalSamples(),
  });
}

describe('createSignal', () => {
  it('preserves every sample it was given', () => {
    expect([...nominalSignal().samples]).toEqual(nominalSamples());
  });

  it('reports the declared metadata', () => {
    const signal = nominalSignal();

    expect(signal.id).toBe('attitude.roll');
    expect(signal.unit).toBe('rad');
    expect(signal.sourceUnit).toBe('cdeg');
    expect(signal.derived).toBe(false);
    expect(signal.timeBase).toBe(timeBase);
  });

  it('accepts an interpolated sample carrying a finite value (ADR-0007)', () => {
    const signal = createSignal({
      id: 'attitude.roll',
      unit: 'rad',
      sourceUnit: null,
      timeBase,
      samples: [{ t_rel_seconds: 0.25, value: 0.15, validity: Validity.INTERPOLATED }],
    });

    expect(signal.samples[0]?.value).toBe(0.15);
    expect(signal.samples[0]?.validity).toBe(Validity.INTERPOLATED);
  });

  it('accepts an empty signal, which is not the same as a missing one', () => {
    const signal = createSignal({
      id: 'battery.current',
      unit: 'A',
      sourceUnit: 'cA',
      timeBase,
      samples: [],
    });

    expect(signal.samples.length).toBe(0);
    expect([...signal.samples]).toEqual([]);
  });

  it('freezes the signal so it cannot drift after construction (invariant 4)', () => {
    expect(Object.isFrozen(nominalSignal())).toBe(true);
  });

  describe('rejects samples that would violate invariants 1a/1b', () => {
    it.each([Validity.MISSING, Validity.INVALID, Validity.UNSUPPORTED])(
      'rejects a finite value paired with %s',
      (validity) => {
        expect(() =>
          createSignal({
            id: 'a',
            unit: 'm',
            sourceUnit: null,
            timeBase,
            samples: [{ t_rel_seconds: 0, value: 0, validity }],
          }),
        ).toThrow(InvalidSignalError);
      },
    );

    it.each([Validity.VALID, Validity.INTERPOLATED])('rejects NaN paired with %s', (validity) => {
      expect(() =>
        createSignal({
          id: 'a',
          unit: 'm',
          sourceUnit: null,
          timeBase,
          samples: [{ t_rel_seconds: 0, value: NaN, validity }],
        }),
      ).toThrow(InvalidSignalError);
    });

    it('rejects a non-finite sample timestamp', () => {
      expect(() =>
        createSignal({
          id: 'a',
          unit: 'm',
          sourceUnit: null,
          timeBase,
          samples: [{ t_rel_seconds: Infinity, value: 1, validity: Validity.VALID }],
        }),
      ).toThrow(InvalidSignalError);
    });

    it('names the offending sample index and signal in the error', () => {
      try {
        createSignal({
          id: 'attitude.roll',
          unit: 'rad',
          sourceUnit: null,
          timeBase,
          samples: [
            { t_rel_seconds: 0, value: 1, validity: Validity.VALID },
            { t_rel_seconds: 1, value: 7, validity: Validity.INVALID },
          ],
        });
        expect.unreachable('should have thrown');
      } catch (error) {
        const invalid = error as InvalidSignalError;
        expect(invalid.code).toBe('INVALID_SIGNAL');
        expect(invalid.context.signalId).toBe('attitude.roll');
        expect(invalid.context.index).toBe(1);
      }
    });
  });

  describe('rejects malformed signal metadata', () => {
    it('rejects an empty id', () => {
      expect(() =>
        createSignal({ id: '', unit: 'm', sourceUnit: null, timeBase, samples: [] }),
      ).toThrow(InvalidSignalError);
    });

    it('rejects a unit outside CanonicalUnit', () => {
      expect(() =>
        createSignal({
          id: 'a',
          unit: 'deg' as 'rad',
          sourceUnit: null,
          timeBase,
          samples: [],
        }),
      ).toThrow(InvalidSignalError);
    });

    it('rejects derived: true without a derivation block (doc 02 §5)', () => {
      expect(() =>
        createSignal({
          id: 'a',
          unit: 'm',
          sourceUnit: null,
          timeBase,
          samples: [],
          derived: true,
        }),
      ).toThrow(InvalidSignalError);
    });

    it('rejects a derivation block on a non-derived signal', () => {
      expect(() =>
        createSignal({
          id: 'a',
          unit: 'm',
          sourceUnit: null,
          timeBase,
          samples: [],
          derivation: { method: 'core-domain:lowpass-4hz', version: '1.0.0', inputs: ['b'] },
        }),
      ).toThrow(InvalidSignalError);
    });

    it('rejects a derivation naming no inputs', () => {
      expect(() =>
        createSignal({
          id: 'a',
          unit: 'm',
          sourceUnit: null,
          timeBase,
          samples: [],
          derived: true,
          derivation: { method: 'core-domain:lowpass-4hz', version: '1.0.0', inputs: [] },
        }),
      ).toThrow(InvalidSignalError);
    });

    it('accepts a well-formed derived signal', () => {
      const signal = createSignal({
        id: 'attitude.roll.filtered',
        unit: 'rad',
        sourceUnit: null,
        timeBase,
        samples: [],
        derived: true,
        derivation: {
          method: 'core-domain:lowpass-4hz',
          version: '1.0.0',
          inputs: ['attitude.roll'],
        },
      });

      expect(signal.derived).toBe(true);
      expect(signal.derivation?.inputs).toEqual(['attitude.roll']);
    });
  });
});

describe('typed-array storage (doc 02 §4)', () => {
  it('stores numbers in parallel typed arrays, not in objects', () => {
    const columns = getSignalColumns(nominalSignal());

    expect(columns).not.toBeNull();
    expect(columns?.t).toBeInstanceOf(Float64Array);
    expect(columns?.values).toBeInstanceOf(Float64Array);
    expect(columns?.validity).toBeInstanceOf(Uint8Array);
  });

  it('exposes the same numbers through the columns and the sample view', () => {
    const columns = getSignalColumns(nominalSignal());

    expect(Array.from(columns?.t ?? [])).toEqual([0, 0.5, 1]);
    expect(columns?.values[1]).toBeNaN();
    expect(validityFromCode(columns?.validity[1] ?? -1)).toBe(Validity.MISSING);
  });

  it('round-trips every Validity through its numeric code', () => {
    for (const validity of Object.values(Validity)) {
      expect(validityFromCode(VALIDITY_CODES[validity])).toBe(validity);
    }
  });

  it('builds directly from columns without going through Sample objects', () => {
    const signal = createSignalFromColumns({
      id: 'baro.pressure',
      unit: 'Pa',
      sourceUnit: 'hPa',
      timeBase,
      columns: {
        t: Float64Array.from([0, 1]),
        values: Float64Array.from([101325, NaN]),
        validity: Uint8Array.from([
          VALIDITY_CODES[Validity.VALID],
          VALIDITY_CODES[Validity.MISSING],
        ]),
      },
    });

    expect(signal.samples.length).toBe(2);
    expect(signal.samples[0]?.value).toBe(101325);
    expect(signal.samples[1]?.validity).toBe(Validity.MISSING);
  });

  it('rejects columns of mismatched length rather than truncating', () => {
    expect(() =>
      createSignalFromColumns({
        id: 'a',
        unit: 'm',
        sourceUnit: null,
        timeBase,
        columns: {
          t: Float64Array.from([0, 1]),
          values: Float64Array.from([1]),
          validity: Uint8Array.from([0, 0]),
        },
      }),
    ).toThrow(InvalidSignalError);
  });

  it('rejects an unrecognised validity code', () => {
    expect(() =>
      createSignalFromColumns({
        id: 'a',
        unit: 'm',
        sourceUnit: null,
        timeBase,
        columns: {
          t: Float64Array.from([0]),
          values: Float64Array.from([1]),
          validity: Uint8Array.from([200]),
        },
      }),
    ).toThrow(InvalidSignalError);
  });

  it('enforces invariants 1a/1b on column input too', () => {
    expect(() =>
      createSignalFromColumns({
        id: 'a',
        unit: 'm',
        sourceUnit: null,
        timeBase,
        columns: {
          t: Float64Array.from([0]),
          values: Float64Array.from([5]),
          validity: Uint8Array.from([VALIDITY_CODES[Validity.MISSING]]),
        },
      }),
    ).toThrow(InvalidSignalError);
  });

  it('copies its input columns so a caller cannot mutate the signal afterwards', () => {
    const t = Float64Array.from([0, 1]);
    const values = Float64Array.from([1, 2]);
    const validity = Uint8Array.from([0, 0]);
    const signal = createSignalFromColumns({
      id: 'a',
      unit: 'm',
      sourceUnit: null,
      timeBase,
      columns: { t, values, validity },
    });

    values[0] = 999;

    expect(signal.samples[0]?.value).toBe(1);
  });
});

describe('the sample view behaves like a readonly array', () => {
  it('passes Array.isArray, so downstream code can treat it as one', () => {
    expect(Array.isArray(nominalSignal().samples)).toBe(true);
  });

  it('supports index access and length', () => {
    const { samples } = nominalSignal();

    expect(samples.length).toBe(3);
    expect(samples[0]?.t_rel_seconds).toBe(0);
    expect(samples[2]?.value).toBe(0.3);
  });

  it('returns undefined outside its bounds rather than a fabricated sample', () => {
    const { samples } = nominalSignal();

    expect(samples[3]).toBeUndefined();
    expect(samples[-1]).toBeUndefined();
  });

  it('supports iteration and spread', () => {
    expect([...nominalSignal().samples]).toHaveLength(3);
  });

  it('supports the array methods analysis code will reach for', () => {
    const { samples } = nominalSignal();

    expect(samples.filter((s) => s.validity === Validity.VALID)).toHaveLength(2);
    expect(samples.map((s) => s.t_rel_seconds)).toEqual([0, 0.5, 1]);
    expect(samples.slice(1)).toHaveLength(2);
    expect(samples.at(-1)?.t_rel_seconds).toBe(1);
    expect(samples.findIndex((s) => s.validity === Validity.MISSING)).toBe(1);
  });

  it('yields frozen samples, so a consumer cannot edit the underlying data', () => {
    expect(Object.isFrozen(nominalSignal().samples[0])).toBe(true);
  });
});
