/**
 * Canonical → display unit conversion — doc 04 §1 rule 7.
 *
 * The rule is that no conversion factor exists outside this package. That applies in both
 * directions: an engineer reading a plot wants degrees, and the alternative to putting the
 * radian-to-degree factor here is putting it in a Vue component, which is exactly what the rule
 * forbids. `apps/web` asks for a display value; it never multiplies.
 */
import { describe, expect, it } from 'vitest';

import { DISPLAY_UNIT_OF, toDisplayUnit } from '@pandalog/core-domain';
import { CANONICAL_UNITS, type CanonicalUnit } from '@pandalog/schema';

describe('toDisplayUnit', () => {
  it('shows angles in degrees, which is what a flight-test engineer reads', () => {
    const displayed = toDisplayUnit(Math.PI, 'rad');

    expect(displayed.value).toBeCloseTo(180, 9);
    expect(displayed.unit).toBe('deg');
  });

  it('round-trips the canonical value it was given', () => {
    const displayed = toDisplayUnit(0.0873, 'rad');

    expect((displayed.value * Math.PI) / 180).toBeCloseTo(0.0873, 9);
  });

  it.each([
    ['m/s^2', 3.5],
    ['m', 12.5],
    ['m/s', 4.2],
    ['unitless', 3],
  ] as [CanonicalUnit, number][])('leaves %s alone — SI is already what to show', (unit, value) => {
    const displayed = toDisplayUnit(value, unit);

    expect(displayed.value).toBe(value);
    expect(displayed.unit).toBe(unit);
  });

  it('shows temperature in degrees Celsius, an offset rather than a scale', () => {
    const displayed = toDisplayUnit(293.15, 'K');

    expect(displayed.value).toBeCloseTo(20, 9);
    expect(displayed.unit).toBe('degC');
  });

  it('shows angular rate in degrees per second', () => {
    expect(toDisplayUnit(Math.PI, 'rad/s').value).toBeCloseTo(180, 9);
    expect(toDisplayUnit(1, 'rad/s').unit).toBe('deg/s');
  });

  it('passes NaN through rather than turning absent data into a number', () => {
    expect(Number.isNaN(toDisplayUnit(NaN, 'rad').value)).toBe(true);
  });

  it('reports the display unit without needing a value', () => {
    expect(DISPLAY_UNIT_OF('rad')).toBe('deg');
    expect(DISPLAY_UNIT_OF('m/s')).toBe('m/s');
  });

  it('has a display unit for every canonical unit, so no signal renders unlabelled', () => {
    // Driven off CANONICAL_UNITS rather than a copied list: adding a canonical unit must fail here
    // until it has a display form, instead of silently rendering as `undefined` in a plot axis.
    for (const unit of CANONICAL_UNITS) {
      expect(DISPLAY_UNIT_OF(unit), `${unit} has no display unit`).toBeTruthy();
    }
  });
});
