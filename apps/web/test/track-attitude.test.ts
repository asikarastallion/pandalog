/**
 * Ground track and attitude geometry.
 *
 * The track tests centre on the same property as the plot's: a stretch with no fix breaks the line.
 * Joining across it would draw a leg that was never flown, and the worse the data, the longer and
 * more confident that invented leg becomes.
 *
 * The rotation tests check known poses against the aerospace convention rather than against the
 * implementation. Getting the rotation order wrong yields a picture that looks plausible at every
 * attitude except the ones you check.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';

import { attitudeGlyph, rotateBodyToWorld } from '../src/workspace/attitude3d.js';
import { buildGroundTrack, trackGeoBounds, trackViewport } from '../src/workspace/track.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const load = (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

describe('ground track', () => {
  let degraded: PipelineResult;
  let nominal: PipelineResult;

  beforeAll(async () => {
    [degraded, nominal] = await Promise.all([load('degraded-flight.bin'), load('nominal.bin')]);
  });

  it('draws one unbroken segment for a flight that never loses its fix', () => {
    const track = buildGroundTrack(nominal.dataset);

    expect(track.segments).toHaveLength(1);
    expect(track.gapCount).toBe(0);
    expect(track.pointCount).toBeGreaterThan(0);
  });

  it('breaks across the outage rather than flying a straight line through it', () => {
    const track = buildGroundTrack(degraded.dataset);

    expect(track.segments.length).toBeGreaterThan(1);
    expect(track.gapCount).toBeGreaterThan(0);
  });

  it('plots no point during the outage — not even at the origin', () => {
    const track = buildGroundTrack(degraded.dataset);

    for (const segment of track.segments) {
      for (const point of segment) {
        expect(point.tSeconds < 3 || point.tSeconds >= 6, `t=${String(point.tSeconds)}`).toBe(true);
      }
    }
  });

  it('anchors the projection on the first fix, putting it at the origin', () => {
    const track = buildGroundTrack(nominal.dataset);
    const first = track.segments[0]?.[0];

    expect(first?.eastMeters).toBeCloseTo(0, 6);
    expect(first?.northMeters).toBeCloseTo(0, 6);
  });

  it('reports an empty track for a dataset with no position at all', () => {
    const stripped = {
      ...nominal.dataset,
      signals: new Map([...nominal.dataset.signals].filter(([id]) => !id.startsWith('gps.'))),
    };

    const track = buildGroundTrack(stripped);

    expect(track.pointCount).toBe(0);
    expect(track.bounds).toBeNull();
  });

  it('reports geographic bounds around the reference, for labelling without a basemap', () => {
    const track = buildGroundTrack(nominal.dataset);
    const bounds = trackGeoBounds(track);

    expect(bounds).not.toBeNull();
    expect(bounds?.northRad).toBeGreaterThanOrEqual(bounds?.southRad ?? 0);
    expect(bounds?.eastRad).toBeGreaterThanOrEqual(bounds?.westRad ?? 0);
  });
});

describe('track viewport', () => {
  it('keeps a square aspect, so a metre east is a metre north on screen', () => {
    const fake = {
      reference: { latitudeRad: 0, longitudeRad: 0 },
      segments: [],
      bounds: { minEast: 0, maxEast: 100, minNorth: 0, maxNorth: 20 },
      pointCount: 2,
      gapCount: 0,
    };

    const viewport = trackViewport(fake, 400, 400);
    const eastSpan = viewport.toX(100) - viewport.toX(0);
    const northSpan = viewport.toY(0) - viewport.toY(100);

    expect(eastSpan).toBeCloseTo(northSpan, 6);
  });

  it('puts north up', () => {
    const fake = {
      reference: { latitudeRad: 0, longitudeRad: 0 },
      segments: [],
      bounds: { minEast: 0, maxEast: 100, minNorth: 0, maxNorth: 100 },
      pointCount: 2,
      gapCount: 0,
    };

    const viewport = trackViewport(fake, 400, 400);

    expect(viewport.toY(100)).toBeLessThan(viewport.toY(0));
  });

  it('does not divide by zero for a stationary vehicle', () => {
    const fake = {
      reference: { latitudeRad: 0, longitudeRad: 0 },
      segments: [],
      bounds: { minEast: 5, maxEast: 5, minNorth: 5, maxNorth: 5 },
      pointCount: 1,
      gapCount: 0,
    };

    const viewport = trackViewport(fake, 400, 400);

    expect(Number.isFinite(viewport.toX(5))).toBe(true);
    expect(Number.isFinite(viewport.metresPerPixel)).toBe(true);
  });
});

describe('body-to-world rotation (aerospace ZYX)', () => {
  const forward = { x: 1, y: 0, z: 0 };
  const right = { x: 0, y: 1, z: 0 };
  const down = { x: 0, y: 0, z: 1 };

  it('is the identity when level and pointing north', () => {
    const rotated = rotateBodyToWorld(forward, 0, 0, 0);

    expect(rotated.x).toBeCloseTo(1, 12);
    expect(rotated.y).toBeCloseTo(0, 12);
    expect(rotated.z).toBeCloseTo(0, 12);
  });

  it('turns the nose east at 90° of yaw', () => {
    const rotated = rotateBodyToWorld(forward, 0, 0, Math.PI / 2);

    expect(rotated.x).toBeCloseTo(0, 12);
    expect(rotated.y).toBeCloseTo(1, 12);
  });

  it('raises the nose at positive pitch — up is negative z', () => {
    const rotated = rotateBodyToWorld(forward, 0, Math.PI / 2, 0);

    expect(rotated.z).toBeCloseTo(-1, 12);
  });

  it('drops the right wing at positive roll', () => {
    const rotated = rotateBodyToWorld(right, Math.PI / 2, 0, 0);

    expect(rotated.z).toBeCloseTo(1, 12);
  });

  it('leaves the roll axis untouched by roll', () => {
    const rotated = rotateBodyToWorld(forward, 0.7, 0, 0);

    expect(rotated.x).toBeCloseTo(1, 12);
  });

  it('preserves length at every attitude — a rotation cannot stretch the airframe', () => {
    const magnitude = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z);

    for (const vector of [forward, right, down, { x: 0.3, y: -0.6, z: 0.2 }]) {
      for (const [r, p, y] of [
        [0.3, -0.2, 1.1],
        [-1.2, 0.9, -2.4],
        [Math.PI, Math.PI / 3, -Math.PI / 2],
      ]) {
        const rotated = rotateBodyToWorld(vector, r ?? 0, p ?? 0, y ?? 0);
        expect(magnitude(rotated)).toBeCloseTo(magnitude(vector), 12);
      }
    }
  });

  it('applies roll before yaw, not after — the order is what makes it aerospace', () => {
    // At 90° yaw with 90° roll, the body "right" axis ends up pointing down, not north.
    const rotated = rotateBodyToWorld(right, Math.PI / 2, 0, Math.PI / 2);

    expect(rotated.z).toBeCloseTo(1, 12);
    expect(rotated.x).toBeCloseTo(0, 12);
  });
});

describe('attitude glyph', () => {
  it('produces one edge per airframe member plus a horizon', () => {
    const glyph = attitudeGlyph(0, 0, 0, 200);

    expect(glyph.edges).toHaveLength(4);
    expect(glyph.horizon).toHaveLength(2);
  });

  it('draws far edges first, so the near wing is on top', () => {
    const glyph = attitudeGlyph(0, 0, 0, 200);
    const depths = glyph.edges.map(([a, b]) => (a.depth + b.depth) / 2);

    expect([...depths]).toEqual([...depths].sort((a, b) => a - b));
  });

  it('keeps the horizon fixed while the aircraft rolls', () => {
    const level = attitudeGlyph(0, 0, 0, 200);
    const rolled = attitudeGlyph(0.6, 0, 0, 200);

    expect(rolled.horizon).toEqual(level.horizon);
    expect(rolled.edges).not.toEqual(level.edges);
  });

  it('produces finite coordinates at every attitude', () => {
    for (const [r, p, y] of [
      [0, 0, 0],
      [Math.PI, -Math.PI / 2, Math.PI],
      [-2.9, 1.4, -0.3],
    ]) {
      const glyph = attitudeGlyph(r ?? 0, p ?? 0, y ?? 0, 200);
      for (const [a, b] of glyph.edges) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      }
    }
  });
});
