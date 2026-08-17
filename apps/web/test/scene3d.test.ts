/**
 * The 3D scene — the Phase I deliverable ADR-0015 records as having been outstanding.
 *
 * Perspective projection is easy to get subtly wrong in a way that still looks like a picture: a
 * sign error puts the camera underground, a swapped basis vector mirrors the path, and either
 * renders something plausible. So these test against poses whose answer is known independently
 * rather than against whatever the code currently produces.
 */
import { describe, expect, it } from 'vitest';

import {
  byDepth,
  cameraPosition,
  clampElevation,
  DEFAULT_CAMERA,
  frameTrajectory,
  groundGrid,
  projectPoint,
  projectPolyline,
  type Camera,
  type Vector3,
} from '../src/workspace/scene3d.js';

const SIZE = 400;

/** Looking due north from the south, level, 100 m back. */
const LEVEL_FROM_SOUTH: Camera = {
  ...DEFAULT_CAMERA,
  target: { x: 0, y: 0, z: 0 },
  azimuthRad: 0,
  elevationRad: 0,
  distanceMeters: 100,
};

describe('cameraPosition', () => {
  it('places a level southward camera due south of its target', () => {
    const eye = cameraPosition(LEVEL_FROM_SOUTH);

    expect(eye.x).toBeCloseTo(0, 9);
    expect(eye.y).toBeCloseTo(-100, 9);
    expect(eye.z).toBeCloseTo(0, 9);
  });

  it('raises the camera as elevation increases, and never below its target when looking down', () => {
    const raised = cameraPosition({ ...LEVEL_FROM_SOUTH, elevationRad: Math.PI / 6 });

    expect(raised.z).toBeCloseTo(50, 9); // 100 · sin 30°
    expect(raised.y).toBeCloseTo(-86.6025, 3); // −100 · cos 30°
  });

  it('orbits horizontally without changing distance to the target', () => {
    for (const azimuthRad of [0, 1, 2.5, -1.2, Math.PI]) {
      const eye = cameraPosition({ ...LEVEL_FROM_SOUTH, azimuthRad });
      const distance = Math.hypot(eye.x, eye.y, eye.z);

      expect(distance, `azimuth ${String(azimuthRad)}`).toBeCloseTo(100, 6);
    }
  });
});

describe('projectPoint', () => {
  it('puts the camera target at the centre of the viewport', () => {
    const projected = projectPoint({ x: 0, y: 0, z: 0 }, LEVEL_FROM_SOUTH, SIZE, SIZE);

    expect(projected?.x).toBeCloseTo(SIZE / 2, 6);
    expect(projected?.y).toBeCloseTo(SIZE / 2, 6);
    expect(projected?.depth).toBeCloseTo(100, 6);
  });

  it('puts a point to the east on the right of a north-facing view', () => {
    const projected = projectPoint({ x: 10, y: 0, z: 0 }, LEVEL_FROM_SOUTH, SIZE, SIZE);

    expect(projected).not.toBeNull();
    expect(projected?.x).toBeGreaterThan(SIZE / 2);
  });

  it('puts a point above the target higher up the screen', () => {
    // Screen y grows downward, so "higher in the world" must mean "smaller y".
    const projected = projectPoint({ x: 0, y: 0, z: 10 }, LEVEL_FROM_SOUTH, SIZE, SIZE);

    expect(projected?.y).toBeLessThan(SIZE / 2);
  });

  it('refuses to project a point behind the camera rather than mirroring it', () => {
    // 200 m south of the target is 100 m behind a camera sitting 100 m south. A renderer that
    // wrapped it would draw a leg of flight on the wrong side of the screen.
    const behind = projectPoint({ x: 0, y: -200, z: 0 }, LEVEL_FROM_SOUTH, SIZE, SIZE);

    expect(behind).toBeNull();
  });

  it('makes a further point project closer to the centre than a nearer one', () => {
    const near = projectPoint({ x: 10, y: 0, z: 0 }, LEVEL_FROM_SOUTH, SIZE, SIZE);
    const far = projectPoint({ x: 10, y: 400, z: 0 }, LEVEL_FROM_SOUTH, SIZE, SIZE);

    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    // This is what makes it perspective rather than orthographic: the same 10 m offset subtends a
    // smaller angle when it is further away.
    expect((far?.x ?? 0) - SIZE / 2).toBeLessThan((near?.x ?? 0) - SIZE / 2);
    expect(far?.depth).toBeGreaterThan(near?.depth ?? 0);
  });

  it('scales with the field of view, so a narrower lens magnifies', () => {
    const wide = projectPoint({ x: 10, y: 0, z: 0 }, LEVEL_FROM_SOUTH, SIZE, SIZE);
    const narrow = projectPoint(
      { x: 10, y: 0, z: 0 },
      { ...LEVEL_FROM_SOUTH, fieldOfViewRad: Math.PI / 8 },
      SIZE,
      SIZE,
    );

    expect((narrow?.x ?? 0) - SIZE / 2).toBeGreaterThan((wide?.x ?? 0) - SIZE / 2);
  });
});

describe('projectPolyline', () => {
  const path: Vector3[] = [
    { x: -20, y: 0, z: 0 },
    { x: 0, y: 0, z: 10 },
    { x: 20, y: 0, z: 0 },
  ];

  it('produces one segment fewer than it has points', () => {
    expect(projectPolyline(path, LEVEL_FROM_SOUTH, SIZE, SIZE)).toHaveLength(2);
  });

  it('drops a segment with an end behind the camera rather than clipping it', () => {
    // Clipping would put the endpoint on the near plane — a position the aircraft never held.
    const crossing: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -500, z: 0 },
    ];

    expect(projectPolyline(crossing, LEVEL_FROM_SOUTH, SIZE, SIZE)).toEqual([]);
  });

  it('yields nothing for a path of one point, which has no segment', () => {
    expect(projectPolyline([{ x: 0, y: 0, z: 0 }], LEVEL_FROM_SOUTH, SIZE, SIZE)).toEqual([]);
  });

  it('orders furthest-first when sorted, so nearer geometry draws on top', () => {
    const far = { from: { x: 0, y: 0, depth: 90 }, to: { x: 1, y: 1, depth: 90 }, depth: 90 };
    const near = { from: { x: 0, y: 0, depth: 10 }, to: { x: 1, y: 1, depth: 10 }, depth: 10 };

    expect([near, far].sort(byDepth).map((segment) => segment.depth)).toEqual([90, 10]);
  });
});

describe('frameTrajectory', () => {
  it('centres on the path and pulls back far enough to see it', () => {
    const path: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 40, z: 20 },
    ];

    const camera = frameTrajectory(path);

    expect(camera.target.x).toBeCloseTo(50, 6);
    expect(camera.target.y).toBeCloseTo(20, 6);
    expect(camera.target.z).toBeCloseTo(10, 6);
    expect(camera.distanceMeters).toBeGreaterThan(100);
  });

  it('scales to the flight, so a hover and a transit both open usably', () => {
    const hover = frameTrajectory([
      { x: 0, y: 0, z: 0 },
      { x: 8, y: 8, z: 3 },
    ]);
    const transit = frameTrajectory([
      { x: 0, y: 0, z: 0 },
      { x: 4000, y: 500, z: 200 },
    ]);

    expect(hover.distanceMeters).toBeLessThan(50);
    expect(transit.distanceMeters).toBeGreaterThan(1000);
  });

  it('falls back to the default camera for an empty path rather than dividing by nothing', () => {
    expect(frameTrajectory([])).toEqual(DEFAULT_CAMERA);
  });

  it('gives a stationary flight a usable distance instead of zero', () => {
    const camera = frameTrajectory([
      { x: 5, y: 5, z: 5 },
      { x: 5, y: 5, z: 5 },
    ]);

    expect(camera.distanceMeters).toBeGreaterThan(0);
    expect(Number.isFinite(camera.distanceMeters)).toBe(true);
  });
});

describe('camera limits and grid', () => {
  it('stops the orbit short of straight up and straight down', () => {
    expect(clampElevation(Math.PI)).toBeLessThan(Math.PI / 2);
    expect(clampElevation(-Math.PI)).toBeGreaterThan(-Math.PI / 2);
    expect(clampElevation(0.3)).toBeCloseTo(0.3, 9);
  });

  it('builds a closed grid of the requested extent', () => {
    const lines = groundGrid(100, 4);

    // Five lines each way for four divisions.
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      for (const point of line) {
        expect(point.z).toBe(0);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(50.000001);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(50.000001);
      }
    }
  });
});
