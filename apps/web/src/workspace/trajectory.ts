/**
 * The flown path with altitude — the third dimension the ground track leaves out.
 *
 * `track.ts` already resolves latitude and longitude into east/north metres and, importantly,
 * already breaks the path where the GNSS fix was lost. This adds height and nothing else: it reuses
 * that segmentation rather than re-deriving it, so the 3D path breaks in exactly the same places
 * as the 2D one and the two views cannot disagree about where the aircraft had no position.
 *
 * Altitude is sampled through `@pandalog/query`'s resampler at each track point's own time, the
 * same way playback samples everything else. Where there is no usable altitude the point is
 * dropped from the 3D path rather than flattened to zero — an aircraft drawn along the ground
 * because its barometer dropped out is a picture of a crash that did not happen (doc 04 §1 rule 6).
 */
import { resampleSignal } from '@pandalog/query';
import { isValueBearing, type CanonicalFlightDataset } from '@pandalog/schema';

import { POSITION_SIGNAL_IDS } from './playback.js';
import type { Vector3 } from './scene3d.js';
import type { GroundTrack, TrackPoint } from './track.js';

export interface TrajectoryPoint extends Vector3 {
  readonly tSeconds: number;
}

export interface Trajectory {
  /** Contiguous runs, broken wherever position or altitude was missing. */
  readonly segments: readonly (readonly TrajectoryPoint[])[];
  readonly pointCount: number;
  /** Altitude range actually flown, or null when none was usable. */
  readonly altitudeRange: { readonly minMeters: number; readonly maxMeters: number } | null;
  /**
   * True when the log carried position but no usable altitude, so the path is 2D data being shown
   * in a 3D view. The view says so rather than letting a flat line read as level flight.
   */
  readonly altitudeMissing: boolean;
}

const EMPTY: Trajectory = Object.freeze({
  segments: [],
  pointCount: 0,
  altitudeRange: null,
  altitudeMissing: false,
});

/** Widest gap altitude will be interpolated across — twice a nominal 5 Hz GNSS altitude rate. */
const MAX_ALTITUDE_GAP_SECONDS = 0.5;

/**
 * Build the 3D path from a dataset and the ground track already computed from it.
 *
 * @param groundTrack the result of `buildGroundTrack` for the same dataset. Passed in rather than
 * recomputed so both views are guaranteed to be describing one path.
 */
export function buildTrajectory(
  dataset: CanonicalFlightDataset,
  groundTrack: GroundTrack,
): Trajectory {
  if (groundTrack.pointCount === 0) {
    return EMPTY;
  }

  const altitude = dataset.signals.get(POSITION_SIGNAL_IDS.altitude);
  const times = groundTrack.segments.flatMap((segment) =>
    segment.map((point: TrackPoint) => point.tSeconds),
  );

  // The resampler requires a strictly increasing grid; track times are already ordered within a
  // segment and segments are ordered between themselves, but a duplicated timestamp across a
  // segment boundary would otherwise throw.
  const grid: number[] = [];
  for (const t of times) {
    const last = grid[grid.length - 1];
    if (last === undefined || t > last) {
      grid.push(t);
    }
  }

  const sampled =
    altitude === undefined || grid.length === 0
      ? null
      : resampleSignal(altitude, { times: grid, maxGapSeconds: MAX_ALTITUDE_GAP_SECONDS });

  const heightAt = new Map<number, number>();
  if (sampled !== null) {
    for (const sample of sampled.samples) {
      if (isValueBearing(sample.validity) && Number.isFinite(sample.value)) {
        heightAt.set(sample.t_rel_seconds, sample.value);
      }
    }
  }

  // Height is drawn relative to the lowest usable altitude, so a field at 900 m AMSL does not put
  // the whole flight a kilometre above the grid. The datum is a display choice; the numbers the
  // readouts show remain the canonical ones.
  let datum = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const height of heightAt.values()) {
    datum = Math.min(datum, height);
    highest = Math.max(highest, height);
  }
  const hasAltitude = heightAt.size > 0;

  const segments: TrajectoryPoint[][] = [];
  let current: TrajectoryPoint[] = [];

  const flush = (): void => {
    if (current.length > 1) {
      segments.push(current);
    }
    current = [];
  };

  for (const segment of groundTrack.segments) {
    for (const point of segment) {
      const height = heightAt.get(point.tSeconds);
      if (height === undefined) {
        // No usable altitude here. Break the path rather than dropping the point to the ground.
        flush();
        continue;
      }
      current.push({
        tSeconds: point.tSeconds,
        x: point.eastMeters,
        y: point.northMeters,
        z: height - datum,
      });
    }
    flush();
  }

  const pointCount = segments.reduce((total, segment) => total + segment.length, 0);

  return Object.freeze({
    segments: Object.freeze(segments.map((segment) => Object.freeze(segment))),
    pointCount,
    altitudeRange: hasAltitude ? Object.freeze({ minMeters: datum, maxMeters: highest }) : null,
    altitudeMissing: !hasAltitude,
  });
}

/** Every point in one run, for framing the camera. */
export const trajectoryPoints = (trajectory: Trajectory): Vector3[] => trajectory.segments.flat();

/**
 * Where the aircraft is at an instant, interpolated along the path.
 *
 * Returns null outside the flown segments rather than clamping to an end: the aircraft was not at
 * the last known point for the rest of the log, it was somewhere nobody recorded.
 */
export function trajectoryAt(trajectory: Trajectory, tSeconds: number): Vector3 | null {
  for (const segment of trajectory.segments) {
    const first = segment[0];
    const last = segment[segment.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }
    if (tSeconds < first.tSeconds || tSeconds > last.tSeconds) {
      continue;
    }

    for (let index = 1; index < segment.length; index += 1) {
      const previous = segment[index - 1];
      const point = segment[index];
      if (previous === undefined || point === undefined || point.tSeconds < tSeconds) {
        continue;
      }

      const span = point.tSeconds - previous.tSeconds;
      const ratio = span <= 0 ? 0 : (tSeconds - previous.tSeconds) / span;
      return {
        x: previous.x + ratio * (point.x - previous.x),
        y: previous.y + ratio * (point.y - previous.y),
        z: previous.z + ratio * (point.z - previous.z),
      };
    }

    return { x: last.x, y: last.y, z: last.z };
  }

  return null;
}
