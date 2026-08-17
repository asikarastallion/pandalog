/**
 * Ground track geometry — ADR-0011.
 *
 * Projects the logged position onto a local tangent plane and lays it out for drawing. The
 * projection itself is `@pandalog/core-domain`'s; this decides framing and where the line breaks.
 *
 * It breaks for the same reason `plot.ts` does. A stretch with no fix is not a straight leg between
 * the last position and the next one — it is a stretch where nobody knows where the aircraft was.
 * Joining across it draws a flight path that was never flown, and the length of that invented leg
 * scales with the length of the outage, so the worse the data the more confident the picture looks.
 */
import { localPlaneScale, toLocalPlane, type GeoReference } from '@pandalog/core-domain';
import { alignSignals } from '@pandalog/query';
import { isValueBearing, type CanonicalFlightDataset } from '@pandalog/schema';

import { POSITION_SIGNAL_IDS } from './playback.js';

export interface TrackPoint {
  readonly tSeconds: number;
  readonly eastMeters: number;
  readonly northMeters: number;
}

export interface GroundTrack {
  /** The point the projection is centred on — the first fix of the flight. */
  readonly reference: GeoReference;
  /** Contiguous runs of fixed position. Separate segments were never connected in the log. */
  readonly segments: readonly (readonly TrackPoint[])[];
  readonly bounds: {
    readonly minEast: number;
    readonly maxEast: number;
    readonly minNorth: number;
    readonly maxNorth: number;
  } | null;
  /** Fixed points, so a caller can say "no position was ever logged" from a fact. */
  readonly pointCount: number;
  /** Number of breaks — stretches of flight with no position. */
  readonly gapCount: number;
}

const EMPTY: GroundTrack = {
  reference: { latitudeRad: 0, longitudeRad: 0 },
  segments: [],
  bounds: null,
  pointCount: 0,
  gapCount: 0,
};

/**
 * Build the ground track from a dataset's position signals.
 *
 * Latitude and longitude are aligned onto latitude's own sample times rather than paired by index:
 * they come from one message today, but pairing by index would silently mis-associate coordinates
 * the day a source logs them separately.
 */
export function buildGroundTrack(dataset: CanonicalFlightDataset): GroundTrack {
  const latitude = dataset.signals.get(POSITION_SIGNAL_IDS.latitude);
  const longitude = dataset.signals.get(POSITION_SIGNAL_IDS.longitude);
  if (latitude === undefined || longitude === undefined) {
    return EMPTY;
  }

  const times = latitude.samples.map((sample) => sample.t_rel_seconds);
  if (times.length === 0) {
    return EMPTY;
  }

  const aligned = alignSignals([latitude, longitude], { times, maxGapSeconds: 0 });
  const [latAligned, lonAligned] = aligned.signals;
  if (latAligned === undefined || lonAligned === undefined) {
    return EMPTY;
  }

  // The first fix anchors the projection. Using the mean would move the whole track when a single
  // outlying fix appears; the first is stable and is what an operator reads as "where we started".
  let reference: GeoReference | null = null;
  for (let index = 0; index < latAligned.samples.length; index += 1) {
    const lat = latAligned.samples[index];
    const lon = lonAligned.samples[index];
    if (
      lat !== undefined &&
      lon !== undefined &&
      isValueBearing(lat.validity) &&
      isValueBearing(lon.validity)
    ) {
      reference = { latitudeRad: lat.value, longitudeRad: lon.value };
      break;
    }
  }
  if (reference === null) {
    return EMPTY;
  }

  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  let minEast = Number.POSITIVE_INFINITY;
  let maxEast = Number.NEGATIVE_INFINITY;
  let minNorth = Number.POSITIVE_INFINITY;
  let maxNorth = Number.NEGATIVE_INFINITY;
  let pointCount = 0;

  for (let index = 0; index < latAligned.samples.length; index += 1) {
    const lat = latAligned.samples[index];
    const lon = lonAligned.samples[index];

    const fixed =
      lat !== undefined &&
      lon !== undefined &&
      isValueBearing(lat.validity) &&
      isValueBearing(lon.validity);

    if (!fixed) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    const offset = toLocalPlane(lat.value, lon.value, reference);
    if (!Number.isFinite(offset.eastMeters) || !Number.isFinite(offset.northMeters)) {
      continue;
    }

    current.push({
      tSeconds: lat.t_rel_seconds,
      eastMeters: offset.eastMeters,
      northMeters: offset.northMeters,
    });
    pointCount += 1;
    minEast = Math.min(minEast, offset.eastMeters);
    maxEast = Math.max(maxEast, offset.eastMeters);
    minNorth = Math.min(minNorth, offset.northMeters);
    maxNorth = Math.max(maxNorth, offset.northMeters);
  }
  if (current.length > 0) {
    segments.push(current);
  }

  return {
    reference,
    segments,
    bounds: pointCount > 0 ? { minEast, maxEast, minNorth, maxNorth } : null,
    pointCount,
    gapCount: Math.max(0, segments.length - 1),
  };
}

export interface TrackViewport {
  readonly width: number;
  readonly height: number;
  /** Metres per pixel, so a scale bar can be drawn. */
  readonly metresPerPixel: number;
  toX: (eastMeters: number) => number;
  toY: (northMeters: number) => number;
}

/** A square-aspect viewport: one metre east is one metre north on screen, or the track is a lie. */
export function trackViewport(track: GroundTrack, width: number, height: number): TrackViewport {
  const bounds = track.bounds;
  const PADDING = 0.1;
  const MINIMUM_EXTENT_METRES = 10;

  const east = bounds === null ? 0 : bounds.maxEast - bounds.minEast;
  const north = bounds === null ? 0 : bounds.maxNorth - bounds.minNorth;
  const extent = Math.max(east, north, MINIMUM_EXTENT_METRES) * (1 + PADDING * 2);

  const centreEast = bounds === null ? 0 : (bounds.minEast + bounds.maxEast) / 2;
  const centreNorth = bounds === null ? 0 : (bounds.minNorth + bounds.maxNorth) / 2;

  const scale = Math.min(width, height) / extent;

  return {
    width,
    height,
    metresPerPixel: 1 / scale,
    toX: (eastMeters: number) => width / 2 + (eastMeters - centreEast) * scale,
    // North is up, and SVG's y axis is not.
    toY: (northMeters: number) => height / 2 - (northMeters - centreNorth) * scale,
  };
}

/**
 * Where a playback position falls on the track's plane, or null when there is no position.
 *
 * Lives here rather than in the map component so the component never calls the projection itself —
 * `tests/architecture/ui-boundary.test.ts` forbids that, and this is the reason the rule is worth
 * having: the projection has an earth model behind it.
 */
export function projectOntoTrack(
  track: GroundTrack,
  position: { readonly latitudeRad: number; readonly longitudeRad: number } | null,
): { readonly eastMeters: number; readonly northMeters: number } | null {
  if (position === null) {
    return null;
  }
  const offset = toLocalPlane(position.latitudeRad, position.longitudeRad, track.reference);
  return Number.isFinite(offset.eastMeters) && Number.isFinite(offset.northMeters) ? offset : null;
}

/** Geographic bounds of the track, in radians, for labelling the view (ADR-0011: no basemap). */
export function trackGeoBounds(track: GroundTrack): {
  readonly southRad: number;
  readonly northRad: number;
  readonly westRad: number;
  readonly eastRad: number;
} | null {
  if (track.bounds === null) {
    return null;
  }
  const scale = localPlaneScale(track.reference.latitudeRad);

  return {
    southRad: track.reference.latitudeRad + track.bounds.minNorth / scale.metresPerRadianNorth,
    northRad: track.reference.latitudeRad + track.bounds.maxNorth / scale.metresPerRadianNorth,
    westRad: track.reference.longitudeRad + track.bounds.minEast / scale.metresPerRadianEast,
    eastRad: track.reference.longitudeRad + track.bounds.maxEast / scale.metresPerRadianEast,
  };
}
