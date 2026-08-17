/**
 * Attitude rendering geometry.
 *
 * Rotates a wireframe airframe by the logged roll/pitch/yaw and projects it for drawing. This is
 * geometry, not domain logic: it consumes canonical radians directly and converts no units, which
 * is why it can live here rather than in `core-domain` — and it is out of the component for the
 * same reason `plot.ts` is, so the rotation can be tested without mounting anything.
 *
 * No 3D library. The airframe is a dozen vertices and the projection is one matrix multiply; a
 * WebGL dependency would be more code to audit than the thing it renders, and this stays
 * inspectable and testable.
 *
 * The rotation order is the aerospace convention — yaw about down, then pitch about the new right,
 * then roll about the new forward (ZYX intrinsic, body 3-2-1) — matching what ArduPilot's
 * roll/pitch/yaw mean. Getting the order wrong produces a picture that looks plausible and is
 * wrong at every attitude but level, so it is stated here and tested against known poses.
 */

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Body frame, in the aerospace convention: x forward, y right, z down.
 *
 * Coordinates are in arbitrary display units — this is a glyph, not a model of any airframe.
 */
const AIRFRAME: readonly (readonly [Vector3, Vector3])[] = Object.freeze([
  // fuselage
  [
    { x: 1.0, y: 0, z: 0 },
    { x: -0.8, y: 0, z: 0 },
  ],
  // wing
  [
    { x: 0.05, y: -0.9, z: 0 },
    { x: 0.05, y: 0.9, z: 0 },
  ],
  // tailplane
  [
    { x: -0.65, y: -0.35, z: 0 },
    { x: -0.65, y: 0.35, z: 0 },
  ],
  // fin
  [
    { x: -0.65, y: 0, z: 0 },
    { x: -0.75, y: 0, z: -0.35 },
  ],
]);

/** Rotate a body-frame vector into the world frame by ZYX intrinsic (yaw, then pitch, then roll). */
export function rotateBodyToWorld(
  vector: Vector3,
  rollRad: number,
  pitchRad: number,
  yawRad: number,
): Vector3 {
  const cosRoll = Math.cos(rollRad);
  const sinRoll = Math.sin(rollRad);
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  // R = Rz(yaw) · Ry(pitch) · Rx(roll), written out rather than composed, so the reader can check
  // it against the standard direction-cosine matrix instead of trusting three multiplications.
  const r11 = cosYaw * cosPitch;
  const r12 = cosYaw * sinPitch * sinRoll - sinYaw * cosRoll;
  const r13 = cosYaw * sinPitch * cosRoll + sinYaw * sinRoll;

  const r21 = sinYaw * cosPitch;
  const r22 = sinYaw * sinPitch * sinRoll + cosYaw * cosRoll;
  const r23 = sinYaw * sinPitch * cosRoll - cosYaw * sinRoll;

  const r31 = -sinPitch;
  const r32 = cosPitch * sinRoll;
  const r33 = cosPitch * cosRoll;

  return {
    x: r11 * vector.x + r12 * vector.y + r13 * vector.z,
    y: r21 * vector.x + r22 * vector.y + r23 * vector.z,
    z: r31 * vector.x + r32 * vector.y + r33 * vector.z,
  };
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** Depth, for drawing far edges before near ones. */
  readonly depth: number;
}

export interface AttitudeGlyph {
  readonly edges: readonly (readonly [ProjectedPoint, ProjectedPoint])[];
  /** The horizon line, so roll and pitch are readable against something fixed. */
  readonly horizon: readonly [ProjectedPoint, ProjectedPoint];
}

/**
 * Project a world-frame vector to the screen.
 *
 * A fixed isometric-style view from behind, above and to the left of the aircraft: an orthographic
 * projection, so equal angles look equal wherever the airframe sits in the frame. Perspective would
 * make the far wing shorter than the near one and invite a reader to misjudge roll.
 */
function project(vector: Vector3, size: number): ProjectedPoint {
  const AZIMUTH = Math.PI / 5;
  const ELEVATION = Math.PI / 7;

  const cosA = Math.cos(AZIMUTH);
  const sinA = Math.sin(AZIMUTH);
  const cosE = Math.cos(ELEVATION);
  const sinE = Math.sin(ELEVATION);

  // World is x north/forward, y east/right, z down; screen y grows downward, hence the sign on z.
  const screenX = vector.y * cosA - vector.x * sinA;
  const screenY = vector.z * cosE - (vector.x * cosA + vector.y * sinA) * sinE;

  return {
    x: size / 2 + screenX * (size / 3),
    y: size / 2 + screenY * (size / 3),
    depth: vector.x * cosA + vector.y * sinA,
  };
}

/** The airframe at a given attitude, ready to draw. */
export function attitudeGlyph(
  rollRad: number,
  pitchRad: number,
  yawRad: number,
  size: number,
): AttitudeGlyph {
  const edges = AIRFRAME.map(([from, to]) => {
    const a = project(rotateBodyToWorld(from, rollRad, pitchRad, yawRad), size);
    const b = project(rotateBodyToWorld(to, rollRad, pitchRad, yawRad), size);
    return [a, b] as const;
  }).sort((first, second) => {
    const depthOf = (edge: readonly [ProjectedPoint, ProjectedPoint]): number =>
      (edge[0].depth + edge[1].depth) / 2;
    return depthOf(first) - depthOf(second);
  });

  // The horizon is world-fixed: it does not rotate with the aircraft, which is what makes the
  // aircraft's rotation legible.
  const horizon = [
    project({ x: 0, y: -1.6, z: 0 }, size),
    project({ x: 0, y: 1.6, z: 0 }, size),
  ] as const;

  return { edges, horizon };
}
