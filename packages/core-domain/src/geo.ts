/**
 * Local tangent-plane projection — ADR-0011, 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §1 rule 7.
 *
 * Turns a canonical latitude/longitude into metres east and north of a reference point, so a ground
 * track can be drawn to scale. It lives here for the same reason the unit table does: it is a
 * conversion with an earth model behind it, and `6378137.0` does not belong in a component.
 *
 * **`LocalPlaneOffset` is a rendering artifact, not a model type.** It is never stored on a
 * `Signal`, never enters a `CanonicalFlightDataset`, and nothing persists it. `packages/schema` is
 * untouched — see ADR-0011, which records that deliberately, because doc 05 Phase I forbids
 * introducing a spatial type outside `schema` without one.
 *
 * **Accuracy.** The projection is a first-order expansion about the reference point using the
 * WGS-84 radii of curvature at that latitude. Error grows with the square of the distance from the
 * reference: below a metre out to roughly 10 km, and a few metres at 50 km. That is far inside what
 * a ground-track plot resolves for a flight, and the function is not appropriate for distances
 * where it stops being — which is why the tolerance is stated rather than implied.
 *
 * Angles are radians, because every angle in the canonical model is (doc 02 §2).
 */

/** WGS-84 semi-major axis, metres. */
const WGS84_SEMI_MAJOR_AXIS_M = 6_378_137.0;
/** WGS-84 flattening. */
const WGS84_FLATTENING = 1 / 298.257223563;
/** First eccentricity squared, e² = f(2 − f). */
const WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2 - WGS84_FLATTENING);

const TWO_PI = 2 * Math.PI;

export interface GeoReference {
  readonly latitudeRad: number;
  readonly longitudeRad: number;
}

/** Metres east and north of a reference point. A display quantity, not part of the model. */
export interface LocalPlaneOffset {
  readonly eastMeters: number;
  readonly northMeters: number;
}

export interface LocalPlaneScale {
  /** Metres per radian of latitude at the reference — the meridional radius of curvature. */
  readonly metresPerRadianNorth: number;
  /** Metres per radian of longitude at the reference — the prime-vertical radius times cos(lat). */
  readonly metresPerRadianEast: number;
}

/**
 * The two radii of curvature that set the local scale.
 *
 * They differ, and the difference is the reason this is not a sphere: a degree of longitude is
 * shorter than a degree of latitude everywhere but the equator, and drawing a track as though they
 * were equal would stretch it east-west.
 */
export function localPlaneScale(latitudeRad: number): LocalPlaneScale {
  const sinLatitude = Math.sin(latitudeRad);
  const oneMinusESinSquared = 1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude;

  const meridional =
    (WGS84_SEMI_MAJOR_AXIS_M * (1 - WGS84_ECCENTRICITY_SQUARED)) / oneMinusESinSquared ** 1.5;
  const primeVertical = WGS84_SEMI_MAJOR_AXIS_M / Math.sqrt(oneMinusESinSquared);

  return {
    metresPerRadianNorth: meridional,
    metresPerRadianEast: primeVertical * Math.cos(latitudeRad),
  };
}

/**
 * Shortest signed angular difference, so a track crossing the antimeridian does not wrap the long
 * way round the planet.
 */
function shortestAngleDifference(angleRad: number, referenceRad: number): number {
  const difference = (angleRad - referenceRad) % TWO_PI;
  if (difference > Math.PI) {
    return difference - TWO_PI;
  }
  if (difference < -Math.PI) {
    return difference + TWO_PI;
  }
  return difference;
}

/**
 * Project a coordinate onto the tangent plane at `reference`.
 *
 * A non-finite input yields a non-finite offset rather than the origin: a sample with no fix must
 * not be drawn at the reference point, which would put the aircraft somewhere it demonstrably was
 * not (doc 04 §1 rule 6).
 */
export function toLocalPlane(
  latitudeRad: number,
  longitudeRad: number,
  reference: GeoReference,
): LocalPlaneOffset {
  if (!Number.isFinite(latitudeRad) || !Number.isFinite(longitudeRad)) {
    return { eastMeters: NaN, northMeters: NaN };
  }

  const scale = localPlaneScale(reference.latitudeRad);

  return {
    northMeters: scale.metresPerRadianNorth * (latitudeRad - reference.latitudeRad),
    eastMeters:
      scale.metresPerRadianEast * shortestAngleDifference(longitudeRad, reference.longitudeRad),
  };
}

/**
 * Recover a coordinate from a tangent-plane offset — the exact inverse of `toLocalPlane`.
 *
 * Needed because the offsets are what the ground track carries, and drawing that track on a
 * geographic map means converting back. Doing it here rather than in the app keeps a single earth
 * model: an inverse written elsewhere with a "metres per degree" constant would disagree with the
 * forward projection by metres at the edges of a flight, and the disagreement would show up as a
 * track that does not sit where the log said it did.
 *
 * The same scale is used as on the way out — evaluated at the reference latitude, not at the
 * recovered one — because that is what makes it an exact inverse rather than an approximate one.
 *
 * A non-finite offset yields a non-finite coordinate rather than the reference point, for the
 * reason `toLocalPlane` does the same in the other direction (doc 04 §1 rule 6).
 */
export function fromLocalPlane(offset: LocalPlaneOffset, reference: GeoReference): GeoReference {
  if (!Number.isFinite(offset.eastMeters) || !Number.isFinite(offset.northMeters)) {
    return { latitudeRad: NaN, longitudeRad: NaN };
  }

  const scale = localPlaneScale(reference.latitudeRad);

  return {
    latitudeRad: reference.latitudeRad + offset.northMeters / scale.metresPerRadianNorth,
    longitudeRad: reference.longitudeRad + offset.eastMeters / scale.metresPerRadianEast,
  };
}
