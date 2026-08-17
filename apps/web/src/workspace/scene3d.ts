/**
 * The flown path in three dimensions — the Phase I deliverable ADR-0015 records as outstanding.
 *
 * `attitude3d.ts` answers "what orientation is it in" with a fixed camera and an orthographic
 * projection. This answers the other half: **where has it been, where is it now, and which way is
 * it pointing along that path** — a perspective camera that can be orbited, the trajectory drawn in
 * space, and the airframe placed on it at the playback instant.
 *
 * No 3D library, for the same reason `attitude3d.ts` has none: the scene is a polyline, a ground
 * grid and a dozen airframe vertices. A WebGL engine would be two orders of magnitude more code
 * than the four functions below, would need a canvas and a render loop where SVG needs neither, and
 * would put a large dependency in a bundle whose entire argument is that it does its work locally.
 *
 * What this is **not**: a renderer. There is no lighting, no depth buffer and no occlusion — edges
 * are painter-sorted by depth and that is all. It is a diagram of a trajectory that happens to be
 * drawn in perspective, which is what reading a flight path needs, and it is worth being plain
 * about the difference.
 *
 * Coordinates follow the canonical convention already used for the ground track and attitude: **x
 * east, y north, z up**, in metres from the trajectory's own origin.
 */

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** Distance from the camera along its view axis. Larger is further away. */
  readonly depth: number;
}

export interface Camera {
  /** Where the camera looks at, in world metres. */
  readonly target: Vector3;
  /** Orbit angle about the vertical axis, radians. 0 looks from the south. */
  readonly azimuthRad: number;
  /** Elevation above the horizontal, radians. Positive looks down at the scene. */
  readonly elevationRad: number;
  /** Distance from the target, metres. */
  readonly distanceMeters: number;
  /** Vertical field of view, radians. */
  readonly fieldOfViewRad: number;
}

export const DEFAULT_CAMERA: Camera = Object.freeze({
  target: Object.freeze({ x: 0, y: 0, z: 0 }),
  // Looking from behind-left and above, the angle a pilot's-eye chase view reads best from.
  azimuthRad: Math.PI * 0.25,
  elevationRad: Math.PI * 0.18,
  distanceMeters: 120,
  fieldOfViewRad: Math.PI / 3,
});

/** Distance in front of the camera below which a point is behind the lens and cannot be drawn. */
const NEAR_PLANE_METERS = 0.5;

const subtract = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

/**
 * The camera's position, derived from its orbit rather than stored.
 *
 * Storing both a position and a target lets them disagree; deriving one means the camera can only
 * ever be looking at what it is supposed to be looking at.
 */
export function cameraPosition(camera: Camera): Vector3 {
  const horizontal = camera.distanceMeters * Math.cos(camera.elevationRad);
  return {
    x: camera.target.x - horizontal * Math.sin(camera.azimuthRad),
    y: camera.target.y - horizontal * Math.cos(camera.azimuthRad),
    z: camera.target.z + camera.distanceMeters * Math.sin(camera.elevationRad),
  };
}

/**
 * Project a world point onto the viewport.
 *
 * Returns null when the point is behind the camera. Null rather than a clamped coordinate on
 * purpose: a point behind the lens has no position on screen, and inventing one draws a line to
 * somewhere the aircraft never was — the same refusal the 2D track makes across a GNSS outage.
 */
export function projectPoint(
  point: Vector3,
  camera: Camera,
  width: number,
  height: number,
): ScreenPoint | null {
  const eye = cameraPosition(camera);
  const relative = subtract(point, eye);

  // Camera basis: forward toward the target, right horizontal, up completing the set.
  const cosElevation = Math.cos(camera.elevationRad);
  const forward: Vector3 = {
    x: Math.sin(camera.azimuthRad) * cosElevation,
    y: Math.cos(camera.azimuthRad) * cosElevation,
    z: -Math.sin(camera.elevationRad),
  };
  const right: Vector3 = { x: Math.cos(camera.azimuthRad), y: -Math.sin(camera.azimuthRad), z: 0 };
  const up: Vector3 = {
    x: -Math.sin(camera.azimuthRad) * Math.sin(camera.elevationRad),
    y: -Math.cos(camera.azimuthRad) * Math.sin(camera.elevationRad),
    z: -cosElevation,
  };

  const depth = relative.x * forward.x + relative.y * forward.y + relative.z * forward.z;
  if (!(depth > NEAR_PLANE_METERS)) {
    return null;
  }

  const horizontal = relative.x * right.x + relative.y * right.y + relative.z * right.z;
  const vertical = relative.x * up.x + relative.y * up.y + relative.z * up.z;

  const focal = height / 2 / Math.tan(camera.fieldOfViewRad / 2);

  return {
    x: width / 2 + (horizontal * focal) / depth,
    y: height / 2 + (vertical * focal) / depth,
    depth,
  };
}

export interface Segment3D {
  readonly from: ScreenPoint;
  readonly to: ScreenPoint;
  /** Mean depth of the two ends, for painter ordering. */
  readonly depth: number;
}

/**
 * Project a run of world points into drawable segments.
 *
 * A segment with either end behind the camera is dropped rather than clipped to the near plane.
 * Clipping would be more correct for a renderer; here it would mean drawing a partial leg whose
 * endpoint is a mathematical artefact rather than a position the aircraft occupied.
 */
export function projectPolyline(
  points: readonly Vector3[],
  camera: Camera,
  width: number,
  height: number,
): Segment3D[] {
  const segments: Segment3D[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    const from = projectPoint(previous, camera, width, height);
    const to = projectPoint(current, camera, width, height);
    if (from === null || to === null) {
      continue;
    }

    segments.push({ from, to, depth: (from.depth + to.depth) / 2 });
  }

  return segments;
}

/** Furthest first, so nearer geometry is drawn over it. */
export const byDepth = (a: Segment3D, b: Segment3D): number => b.depth - a.depth;

/**
 * A camera framing the whole trajectory.
 *
 * Derived from the path's extent so a 40 m hover and a 4 km transit both open at a usable scale;
 * a fixed distance would put one of them in the far distance and the other outside the frame.
 */
export function frameTrajectory(points: readonly Vector3[], base: Camera = DEFAULT_CAMERA): Camera {
  if (points.length === 0) {
    return base;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);

  return {
    ...base,
    target: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    // 1.6x the extent puts the whole path comfortably inside a 60° field of view with margin.
    distanceMeters: extent * 1.6,
  };
}

/** Clamp an orbit so the camera cannot pass through the ground or flip over the top. */
export const clampElevation = (radians: number): number =>
  Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, radians));

/** A ground grid at z = 0, for the scale and orientation a bare polyline in space does not give. */
export function groundGrid(extentMeters: number, divisions = 8): Vector3[][] {
  const half = extentMeters / 2;
  const step = extentMeters / divisions;
  const lines: Vector3[][] = [];

  for (let index = 0; index <= divisions; index += 1) {
    const offset = -half + index * step;
    lines.push([
      { x: -half, y: offset, z: 0 },
      { x: half, y: offset, z: 0 },
    ]);
    lines.push([
      { x: offset, y: -half, z: 0 },
      { x: offset, y: half, z: 0 },
    ]);
  }

  return lines;
}
