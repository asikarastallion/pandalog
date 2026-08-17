/**
 * The flown path in three dimensions.
 *
 * The property that matters most here is that the 3D path breaks in exactly the same places as the
 * 2D ground track. Two views of one flight that disagree about where the aircraft had no position
 * would be worse than having only one of them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline } from '@pandalog/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalFlightDataset } from '@pandalog/schema';

import { buildGroundTrack } from '../src/workspace/track.js';
import { buildTrajectory, trajectoryAt, trajectoryPoints } from '../src/workspace/trajectory.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const load = async (name: string): Promise<CanonicalFlightDataset> =>
  (
    await runPipeline({
      fileName: name,
      bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
  ).dataset;

describe('buildTrajectory', () => {
  let degraded: CanonicalFlightDataset;
  let nominal: CanonicalFlightDataset;

  beforeAll(async () => {
    [degraded, nominal] = await Promise.all([load('degraded-flight.bin'), load('nominal.bin')]);
  });

  it('produces a path with height for a flight that logged position and altitude', () => {
    const track = buildGroundTrack(nominal);
    const trajectory = buildTrajectory(nominal, track);

    expect(trajectory.pointCount).toBeGreaterThan(0);
    expect(trajectory.altitudeMissing).toBe(false);
    expect(trajectory.altitudeRange).not.toBeNull();
  });

  it('breaks in the same places the ground track breaks', () => {
    // degraded-flight.bin loses its GNSS fix mid-flight, so the 2D track is in two segments. The
    // 3D path must be too — a continuous line through the outage would draw a leg nobody recorded,
    // which is the failure the ground track was built to avoid in the first place.
    const track = buildGroundTrack(degraded);
    const trajectory = buildTrajectory(degraded, track);

    expect(track.gapCount).toBeGreaterThan(0);
    expect(trajectory.segments.length).toBeGreaterThan(1);
  });

  it('never places a point where the ground track had none', () => {
    const track = buildGroundTrack(degraded);
    const trajectory = buildTrajectory(degraded, track);

    const trackTimes = new Set(
      track.segments.flatMap((segment) => segment.map((point) => point.tSeconds)),
    );
    for (const segment of trajectory.segments) {
      for (const point of segment) {
        expect(trackTimes.has(point.tSeconds), `t=${String(point.tSeconds)}`).toBe(true);
      }
    }
  });

  it('measures height from the lowest usable altitude, not from sea level', () => {
    // A field at 900 m AMSL should not put the whole flight a kilometre above the grid.
    const trajectory = buildTrajectory(nominal, buildGroundTrack(nominal));
    const heights = trajectoryPoints(trajectory).map((point) => point.z);

    expect(Math.min(...heights)).toBeCloseTo(0, 6);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0);
  });

  it('keeps the canonical altitude range, so a readout can still show real numbers', () => {
    const trajectory = buildTrajectory(nominal, buildGroundTrack(nominal));

    expect(trajectory.altitudeRange?.minMeters).not.toBe(0);
    expect(trajectory.altitudeRange?.maxMeters).toBeGreaterThanOrEqual(
      trajectory.altitudeRange?.minMeters ?? 0,
    );
  });

  it('is empty when the flight logged no position at all', () => {
    const trajectory = buildTrajectory(nominal, {
      reference: { latitudeRad: 0, longitudeRad: 0 },
      segments: [],
      bounds: null,
      pointCount: 0,
      gapCount: 0,
    });

    expect(trajectory.segments).toEqual([]);
    expect(trajectory.pointCount).toBe(0);
  });

  it('reports missing altitude rather than flattening the path onto the ground', () => {
    // A path drawn along the ground because the barometer dropped out is a picture of a crash that
    // did not happen (doc 04 §1 rule 6).
    const withoutAltitude: CanonicalFlightDataset = {
      ...nominal,
      signals: new Map([...nominal.signals.entries()].filter(([id]) => id !== 'gps.altitude')),
    };

    const trajectory = buildTrajectory(withoutAltitude, buildGroundTrack(withoutAltitude));

    expect(trajectory.altitudeMissing).toBe(true);
    expect(trajectory.pointCount).toBe(0);
  });
});

describe('trajectoryAt', () => {
  let trajectory: Awaited<ReturnType<typeof buildTrajectoryFor>>;

  const buildTrajectoryFor = async (name: string) => {
    const dataset = await load(name);
    return buildTrajectory(dataset, buildGroundTrack(dataset));
  };

  beforeAll(async () => {
    trajectory = await buildTrajectoryFor('nominal.bin');
  });

  it('returns the flown point at a time inside the path', () => {
    const first = trajectory.segments[0]?.[0];
    expect(first).toBeDefined();

    const at = trajectoryAt(trajectory, first?.tSeconds ?? 0);

    expect(at?.x).toBeCloseTo(first?.x ?? NaN, 6);
    expect(at?.z).toBeCloseTo(first?.z ?? NaN, 6);
  });

  it('interpolates between two logged points', () => {
    const segment = trajectory.segments[0] ?? [];
    const a = segment[0];
    const b = segment[1];
    if (a === undefined || b === undefined) {
      throw new Error('The fixture no longer produces a multi-point trajectory.');
    }

    const midpoint = trajectoryAt(trajectory, (a.tSeconds + b.tSeconds) / 2);

    expect(midpoint?.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(midpoint?.y).toBeCloseTo((a.y + b.y) / 2, 6);
  });

  it('returns null before the flight rather than clamping to the first point', () => {
    // Clamping would park the aircraft at its first fix for however long the log ran before it,
    // which is a position nobody recorded.
    expect(trajectoryAt(trajectory, -100)).toBeNull();
  });

  it('returns null after the flight', () => {
    expect(trajectoryAt(trajectory, 1e6)).toBeNull();
  });
});
