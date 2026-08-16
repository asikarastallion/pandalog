/**
 * Unit conversion — 02_CANONICAL_DATA_MODEL.md §3 invariant 5, 04 §1 rule 7.
 *
 * core-domain's table is the only place a source unit becomes a canonical one. An unmappable unit
 * throws; it is never assumed to be an identity conversion.
 */
import { describe, expect, it } from 'vitest';

import {
  convertToCanonical,
  getUnitConversion,
  isKnownSourceUnit,
  KNOWN_SOURCE_UNITS,
  UnknownUnitError,
} from '@pandalog/core-domain';
import { isCanonicalUnit } from '@pandalog/schema';

describe('unit conversion table', () => {
  it('maps every declared source unit to a real CanonicalUnit', () => {
    for (const sourceUnit of KNOWN_SOURCE_UNITS) {
      const conversion = getUnitConversion(sourceUnit);
      expect(isCanonicalUnit(conversion.canonicalUnit)).toBe(true);
    }
  });

  it('is deterministic: the same input always yields the same output', () => {
    expect(convertToCanonical(90, 'deg')).toBe(convertToCanonical(90, 'deg'));
  });

  describe('angles', () => {
    it.each([
      ['deg', 180, Math.PI],
      ['deg', -90, -Math.PI / 2],
      ['cdeg', 18000, Math.PI],
      ['rad', 1.5, 1.5],
    ])('converts %s %d to %f rad', (sourceUnit, input, expected) => {
      expect(convertToCanonical(input, sourceUnit)).toBeCloseTo(expected, 12);
    });

    it('converts angular rates', () => {
      expect(convertToCanonical(180, 'deg/s')).toBeCloseTo(Math.PI, 12);
      expect(convertToCanonical(18000, 'cdeg/s')).toBeCloseTo(Math.PI, 12);
    });
  });

  describe('length, velocity, acceleration', () => {
    it.each([
      ['cm', 250, 2.5],
      ['mm', 1500, 1.5],
      ['km', 2, 2000],
      ['cm/s', 150, 1.5],
      ['km/h', 36, 10],
    ])('converts %s %d to %f', (sourceUnit, input, expected) => {
      expect(convertToCanonical(input, sourceUnit)).toBeCloseTo(expected, 12);
    });

    it('converts standard gravity to m/s^2', () => {
      expect(convertToCanonical(1, 'g')).toBeCloseTo(9.80665, 12);
    });
  });

  describe('temperature is affine, not a scale factor', () => {
    it('converts degC to K by offset', () => {
      expect(convertToCanonical(0, 'degC')).toBeCloseTo(273.15, 12);
      expect(convertToCanonical(-273.15, 'degC')).toBeCloseTo(0, 12);
      expect(convertToCanonical(26.85, 'degC')).toBeCloseTo(300, 12);
    });

    it('converts centi-degC to K', () => {
      expect(convertToCanonical(2685, 'cdegC')).toBeCloseTo(300, 12);
    });

    it('does not treat degC as a pure scaling', () => {
      // The bug this guards: implementing degC->K as a multiply would map 0 degC to 0 K.
      expect(convertToCanonical(0, 'degC')).not.toBeCloseTo(0, 6);
    });
  });

  describe('pressure, electrical, time', () => {
    it.each([
      ['hPa', 1013.25, 101325],
      ['mbar', 1013.25, 101325],
      ['kPa', 100, 100000],
      ['mV', 12000, 12],
      ['cV', 1200, 12],
      ['mA', 2500, 2.5],
      ['ms', 1500, 1.5],
      ['us', 1_500_000, 1.5],
    ])('converts %s %d to %f', (sourceUnit, input, expected) => {
      expect(convertToCanonical(input, sourceUnit)).toBeCloseTo(expected, 9);
    });
  });

  describe('unmappable units fail loudly (invariant 5)', () => {
    it('throws UnknownUnitError rather than assuming identity', () => {
      expect(() => convertToCanonical(1, 'furlongs/fortnight')).toThrow(UnknownUnitError);
    });

    it('carries the offending unit as structured context', () => {
      try {
        convertToCanonical(1, 'smoots');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownUnitError);
        const unknownUnit = error as UnknownUnitError;
        expect(unknownUnit.code).toBe('UNKNOWN_UNIT');
        expect(unknownUnit.sourceUnit).toBe('smoots');
        expect(unknownUnit.message).toContain('smoots');
      }
    });

    it('does not silently accept a canonical unit name that is not a declared source unit', () => {
      // "Pa/s" is a CanonicalUnit but has no source-unit entry; asking to convert it must fail
      // rather than quietly pass the number through.
      expect(isKnownSourceUnit('Pa/s')).toBe(false);
      expect(() => convertToCanonical(1, 'Pa/s')).toThrow(UnknownUnitError);
    });

    it.each(['', ' ', 'DEG', 'deg '])('rejects the malformed source unit %o', (sourceUnit) => {
      expect(() => convertToCanonical(1, sourceUnit)).toThrow(UnknownUnitError);
    });
  });

  describe('numeric edge cases', () => {
    it('propagates NaN rather than inventing a value', () => {
      expect(convertToCanonical(NaN, 'deg')).toBeNaN();
    });

    it('handles extreme magnitudes without overflowing to Infinity', () => {
      expect(Number.isFinite(convertToCanonical(1e15, 'cdeg'))).toBe(true);
    });

    it('preserves zero for identity conversions', () => {
      expect(convertToCanonical(0, 'rad')).toBe(0);
    });
  });
});
