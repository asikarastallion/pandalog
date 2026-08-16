/**
 * Typed-array sample storage — 02_CANONICAL_DATA_MODEL.md §4,
 * 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §6.
 *
 * Doc 02 §4 requires two things that pull against each other: `Signal.samples` is logically a
 * `readonly Sample[]`, while the actual storage is parallel typed arrays, and the same numbers must
 * not be held in two representations at once. A materialised array of `Sample` objects would break
 * the second; dropping the array shape would break the first.
 *
 * The resolution is a Proxy over an empty array target. `Array.isArray` still reports true (it
 * pierces proxies to the target), index access and `length` come from the columns, and every
 * `Array.prototype` method works unchanged because those methods only need `length` and indexed
 * reads — both of which the traps serve. `Sample` objects are built on demand and never retained,
 * so the typed arrays remain the single representation of the numbers.
 *
 * Hot paths that would rather not allocate per sample should use `getSignalColumns` and read the
 * typed arrays directly.
 */
import { Validity, type Sample } from '@pandalog/schema';

import { InvalidSignalError } from './errors.js';

/** Parallel numeric storage backing one signal. */
export interface SignalColumns {
  readonly t: Float64Array;
  readonly values: Float64Array;
  /** `Validity` encoded via `VALIDITY_CODES`. */
  readonly validity: Uint8Array;
}

/**
 * Stable numeric encoding of `Validity` for `Uint8Array` storage.
 *
 * These numbers are a storage detail of this package, not a wire format: nothing persists them
 * across versions today. If that changes, they become a versioned contract.
 */
export const VALIDITY_CODES: Readonly<Record<Validity, number>> = Object.freeze({
  [Validity.VALID]: 0,
  [Validity.MISSING]: 1,
  [Validity.INVALID]: 2,
  [Validity.UNSUPPORTED]: 3,
  [Validity.INTERPOLATED]: 4,
});

const CODE_TO_VALIDITY: readonly Validity[] = Object.freeze(
  Object.entries(VALIDITY_CODES)
    .sort(([, a], [, b]) => a - b)
    .map(([validity]) => validity as Validity),
);

export function isValidityCode(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code < CODE_TO_VALIDITY.length;
}

/** Decode a stored validity code. @throws {InvalidSignalError} on an unrecognised code. */
export function validityFromCode(code: number): Validity {
  const validity = CODE_TO_VALIDITY[code];
  if (validity === undefined) {
    throw new InvalidSignalError(`Unrecognised validity code ${String(code)}.`, { code });
  }
  return validity;
}

/** Brand used by `getSignalColumns` to recover the storage behind a sample view. */
export const SAMPLE_VIEW_COLUMNS = Symbol('pandalog.sampleViewColumns');

/**
 * Present the columns as a `readonly Sample[]` without materialising one.
 *
 * Out-of-range indices yield `undefined`, matching real array behaviour, rather than a fabricated
 * sample.
 */
export function createSampleView(columns: SignalColumns): readonly Sample[] {
  const { length } = columns.t;
  const target: Sample[] = [];

  const sampleAt = (index: number): Sample | undefined => {
    const t = columns.t[index];
    const value = columns.values[index];
    const code = columns.validity[index];
    const validity = code === undefined ? undefined : CODE_TO_VALIDITY[code];

    // Out of range in any column means there is no sample here. Returning `undefined` matches how
    // a real array behaves; fabricating one would invent a measurement.
    if (t === undefined || value === undefined || validity === undefined) {
      return undefined;
    }

    return Object.freeze({ t_rel_seconds: t, value, validity });
  };

  const proxy = new Proxy(target, {
    get(receiverTarget, property, receiver): unknown {
      if (property === 'length') {
        return length;
      }
      if (property === SAMPLE_VIEW_COLUMNS) {
        return columns;
      }
      if (property === Symbol.iterator) {
        return function* iterate(): Generator<Sample> {
          for (let index = 0; index < length; index += 1) {
            const sample = sampleAt(index);
            if (sample !== undefined) {
              yield sample;
            }
          }
        };
      }
      if (typeof property === 'string') {
        const index = Number(property);
        if (Number.isInteger(index)) {
          return sampleAt(index);
        }
      }
      // Array.prototype methods reach `length` and indices through these same traps, so they
      // operate correctly over the columns without any per-method special casing.
      return Reflect.get(receiverTarget, property, receiver) as unknown;
    },

    has(receiverTarget, property): boolean {
      if (typeof property === 'string') {
        const index = Number(property);
        if (Number.isInteger(index)) {
          return index >= 0 && index < length;
        }
      }
      return Reflect.has(receiverTarget, property);
    },

    ownKeys(): ArrayLike<string | symbol> {
      const keys: (string | symbol)[] = [];
      for (let index = 0; index < length; index += 1) {
        keys.push(String(index));
      }
      keys.push('length');
      return keys;
    },

    getOwnPropertyDescriptor(receiverTarget, property): PropertyDescriptor | undefined {
      if (typeof property === 'string') {
        const index = Number(property);
        if (Number.isInteger(index) && index >= 0 && index < length) {
          return { value: sampleAt(index), writable: false, enumerable: true, configurable: true };
        }
      }
      if (property === 'length') {
        // `length` is non-configurable on the array target, so the descriptor must report it as
        // such or the Proxy invariant check throws.
        return { value: length, writable: true, enumerable: false, configurable: false };
      }
      return Reflect.getOwnPropertyDescriptor(receiverTarget, property);
    },
  });

  return proxy;
}

/**
 * Recover the typed-array storage behind a signal's samples.
 *
 * Returns the live arrays, not copies, because the point is to avoid allocation on hot paths.
 * Callers must treat them as read-only; writing to them mutates the signal and breaks doc 02 §3
 * invariant 4. Returns null for a signal whose samples did not come from this module.
 */
export function getSampleViewColumns(samples: readonly Sample[]): SignalColumns | null {
  const branded = samples as { [SAMPLE_VIEW_COLUMNS]?: SignalColumns };
  return branded[SAMPLE_VIEW_COLUMNS] ?? null;
}
