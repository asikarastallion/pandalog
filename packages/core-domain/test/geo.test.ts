/**
 * Local tangent-plane projection — ADR-0011, doc 04 §1 rule 7.
 *
 * Expected values are computed from the WGS-84 radii of curvature independently of the
 * implementation, so these tests pin the earth model rather than agreeing with whatever the code
 * happens to do.
 */
import { describe, expect, it } from 'vitest';

import { localPlaneScale, toLocalPlane } from '@pandalog/core-domain';

const deg = (value: number): number => (value * Math.PI) / 180;

/** Ankara-ish, matching the fixtures. */
const REF = { latitudeRad: deg(39.5), longitudeRad: deg(32.8) };

describe('toLocalPlane', () => {
  it('puts the reference point at the origin', () => {
    const offset = toLocalPlane(REF.latitudeRad, REF.longitudeRad, REF);

    expect(offset.eastMeters).toBeCloseTo(0, 9);
    expect(offset.northMeters).toBeCloseTo(0, 9);
  });

  it('moves north for an increase in latitude', () => {
    const offset = toLocalPlane(REF.latitudeRad + deg(0.001), REF.longitudeRad, REF);

    expect(offset.northMeters).toBeGreaterThan(0);
    expect(offset.eastMeters).toBeCloseTo(0, 9);
  });

  it('moves east for an increase in longitude', () => {
    const offset = toLocalPlane(REF.latitudeRad, REF.longitudeRad + deg(0.001), REF);

    expect(offset.eastMeters).toBeGreaterThan(0);
    expect(offset.northMeters).toBeCloseTo(0, 9);
  });

  it('moves south and west for decreases, rather than taking an absolute value', () => {
    const offset = toLocalPlane(REF.latitudeRad - deg(0.001), REF.longitudeRad - deg(0.001), REF);

    expect(offset.northMeters).toBeLessThan(0);
    expect(offset.eastMeters).toBeLessThan(0);
  });

  it('matches the WGS-84 meridional arc for a degree of latitude at 39.5°', () => {
    // M = a(1-e^2)/(1-e^2 sin^2 lat)^1.5 at 39.5°, times one degree in radians. Computed outside
    // this codebase: 111 025.04 m.
    const offset = toLocalPlane(REF.latitudeRad + deg(1), REF.longitudeRad, REF);

    expect(offset.northMeters).toBeCloseTo(111_025.04, 1);
  });

  it('matches the WGS-84 parallel arc for a degree of longitude at 39.5°', () => {
    // N(39.5°) cos(39.5°) times one degree in radians. Computed outside this codebase:
    // 86 013.42 m — shorter than the meridional arc, which is the ellipsoid showing.
    const offset = toLocalPlane(REF.latitudeRad, REF.longitudeRad + deg(1), REF);

    expect(offset.eastMeters).toBeCloseTo(86_013.42, 1);
  });

  it('shrinks the parallel arc towards the pole, which a Mercator projection would not', () => {
    const equator = { latitudeRad: 0, longitudeRad: 0 };
    const high = { latitudeRad: deg(60), longitudeRad: 0 };

    const atEquator = toLocalPlane(0, deg(0.01), equator).eastMeters;
    const atHigh = toLocalPlane(deg(60), deg(0.01), high).eastMeters;

    expect(atHigh).toBeLessThan(atEquator);

    // Close to cos(60°) but not equal to it: the prime-vertical radius itself grows towards the
    // pole, so the true ratio is 0.501260. A sphere would give exactly 0.5, and the difference is
    // the ellipsoid being modelled rather than assumed away.
    expect(atHigh / atEquator).toBeCloseTo(0.50126, 5);
    expect(atHigh / atEquator).not.toBeCloseTo(Math.cos(deg(60)), 5);
  });

  it('is linear over a flight-sized extent, so a scale bar means one thing across the view', () => {
    const near = toLocalPlane(REF.latitudeRad + deg(0.001), REF.longitudeRad, REF).northMeters;
    const far = toLocalPlane(REF.latitudeRad + deg(0.002), REF.longitudeRad, REF).northMeters;

    expect(far / near).toBeCloseTo(2, 6);
  });

  it('passes NaN through rather than projecting an absent fix to the origin', () => {
    const offset = toLocalPlane(NaN, REF.longitudeRad, REF);

    expect(Number.isNaN(offset.eastMeters)).toBe(true);
    expect(Number.isNaN(offset.northMeters)).toBe(true);
  });

  it('handles the antimeridian without wrapping the track around the world', () => {
    const ref = { latitudeRad: 0, longitudeRad: deg(179.999) };
    const offset = toLocalPlane(0, deg(-179.999), ref);

    // 0.002° apart across the seam, not 359.998°.
    expect(Math.abs(offset.eastMeters)).toBeLessThan(300);
  });
});

describe('localPlaneScale', () => {
  it('reports metres per radian at the reference, for a scale bar', () => {
    const scale = localPlaneScale(REF.latitudeRad);

    expect(scale.metresPerRadianNorth).toBeGreaterThan(6_000_000);
    expect(scale.metresPerRadianEast).toBeGreaterThan(4_000_000);
    expect(scale.metresPerRadianEast).toBeLessThan(scale.metresPerRadianNorth);
  });

  it('agrees with the projection it describes', () => {
    const scale = localPlaneScale(REF.latitudeRad);
    const offset = toLocalPlane(REF.latitudeRad + 0.001, REF.longitudeRad + 0.001, REF);

    expect(offset.northMeters).toBeCloseTo(scale.metresPerRadianNorth * 0.001, 6);
    expect(offset.eastMeters).toBeCloseTo(scale.metresPerRadianEast * 0.001, 6);
  });
});
