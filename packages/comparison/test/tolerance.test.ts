/**
 * The numbers that decide materiality — doc 03 §4.
 *
 * `validateTolerance` is the gate every comparison threshold passes through, so each of its
 * refusals is tested directly rather than only through the one path `compareFlights` happens to
 * exercise. A guard that has never been shown to fire is not a guard.
 */
import { describe, expect, it } from 'vitest';

import {
  ComparisonError,
  DEFAULT_EVENT_TIMING_TOLERANCE,
  DEFAULT_SIGNAL_TOLERANCE,
  validateTolerance,
  type ComparisonTolerance,
} from '@pandalog/comparison';

const sound: ComparisonTolerance = {
  label: 'signal difference',
  value: 0.02,
  unit: 'fraction',
  basis: 'provisional',
};

describe('validateTolerance', () => {
  it('accepts a tolerance that says what it bounds, how much, and why', () => {
    expect(validateTolerance(sound)).toEqual(sound);
  });

  it('freezes what it returns, so a validated tolerance cannot be edited afterwards', () => {
    expect(Object.isFrozen(validateTolerance(sound))).toBe(true);
  });

  it('rejects a tolerance with no label', () => {
    expect(() => validateTolerance({ ...sound, label: '   ' })).toThrow(ComparisonError);
  });

  it('rejects a non-finite tolerance', () => {
    // NaN compares false against everything, so `difference > NaN` is never true and every
    // comparison would silently report no difference — the exact failure this package is about.
    expect(() => validateTolerance({ ...sound, value: Number.NaN })).toThrow(/finite/i);
    expect(() => validateTolerance({ ...sound, value: Number.POSITIVE_INFINITY })).toThrow(
      /finite/i,
    );
  });

  it('rejects a negative tolerance', () => {
    expect(() => validateTolerance({ ...sound, value: -0.5 })).toThrow(/negative/i);
  });

  it('accepts a tolerance of exactly zero, which demands exact equality', () => {
    expect(validateTolerance({ ...sound, value: 0 }).value).toBe(0);
  });

  it('rejects a tolerance that does not state its unit', () => {
    expect(() => validateTolerance({ ...sound, unit: '' })).toThrow(/unit/i);
  });

  it('rejects a basis outside doc 03 §4 vocabulary', () => {
    expect(() => validateTolerance({ ...sound, basis: 'seems right' as never })).toThrow(/basis/i);
  });

  it('accepts the three bases doc 03 §4 defines', () => {
    for (const basis of ['provisional', 'spec:DO-178C §6.4', 'empirical:fleet-2025'] as const) {
      expect(validateTolerance({ ...sound, basis }).basis).toBe(basis);
    }
  });

  it('carries a structured code, not just a message', () => {
    try {
      validateTolerance({ ...sound, value: -1 });
      expect.unreachable('validateTolerance accepted a negative bound');
    } catch (error) {
      expect(error).toBeInstanceOf(ComparisonError);
      expect((error as ComparisonError).code).toBe('INVALID_TOLERANCE');
    }
  });
});

describe('the shipped defaults', () => {
  it('are valid by their own gate', () => {
    expect(() => validateTolerance(DEFAULT_SIGNAL_TOLERANCE)).not.toThrow();
    expect(() => validateTolerance(DEFAULT_EVENT_TIMING_TOLERANCE)).not.toThrow();
  });

  it('admit that they are unjustified', () => {
    // Nothing in the repository traces a comparison threshold to a flight-test document yet, and
    // doc 03 §4 permits shipping an unjustified number only if it says that it is unjustified.
    expect(DEFAULT_SIGNAL_TOLERANCE.basis).toBe('provisional');
    expect(DEFAULT_EVENT_TIMING_TOLERANCE.basis).toBe('provisional');
  });
});
