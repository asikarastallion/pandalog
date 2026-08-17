/**
 * Phase I acceptance:
 *
 * > Playback position/attitude at a given timestamp matches the corresponding canonical signal
 * > values within documented interpolation tolerance.
 *
 * "Matches" is tested three ways, because there are three different claims in it:
 *
 *   At a sample time, playback must return that sample exactly — no tolerance at all. A scrubber
 *   that drifted at the very instants the log recorded would be wrong about the data it has.
 *
 *   Between sample times, the value must be the linear interpolant of its neighbours. That is the
 *   documented tolerance: `@pandalog/query`'s `resampleSignal`, whose behaviour is already
 *   specified and tested, and which playback delegates to rather than reimplementing.
 *
 *   Where the log says nothing, playback must say nothing. This is the one that matters most and
 *   the one a demo gets wrong: during a GNSS dropout there is no position, and neither the last
 *   known fix nor a curve drawn across the hole is an acceptable substitute.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { Validity } from '@pandalog/schema';

import {
  ATTITUDE_SIGNAL_IDS,
  playbackStateAt,
  POSITION_SIGNAL_IDS,
} from '../src/workspace/playback.js';

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

let result: PipelineResult;

beforeAll(async () => {
  result = await load('degraded-flight.bin');
});

describe('at a sample time, playback returns that sample exactly', () => {
  it.each(Object.values(ATTITUDE_SIGNAL_IDS))('%s', (signalId) => {
    const signal = result.dataset.signals.get(signalId);
    expect(signal).toBeDefined();

    let checked = 0;
    for (const sample of signal?.samples ?? []) {
      if (!Number.isFinite(sample.value)) {
        continue;
      }
      const channel = playbackStateAt(result, sample.t_rel_seconds).channels.get(signalId);

      expect(channel?.value, `t=${String(sample.t_rel_seconds)}`).toBeCloseTo(sample.value, 12);
      checked += 1;
    }

    expect(checked, 'no samples were actually compared').toBeGreaterThan(10);
  });

  it('holds for latitude while the fix is held', () => {
    const signal = result.dataset.signals.get(POSITION_SIGNAL_IDS.latitude);
    const held = (signal?.samples ?? []).filter((s) => s.validity === Validity.VALID);

    expect(held.length).toBeGreaterThan(0);
    for (const sample of held) {
      const state = playbackStateAt(result, sample.t_rel_seconds);
      expect(state.position?.latitudeRad).toBeCloseTo(sample.value, 12);
    }
  });
});

describe('between sample times, playback is the interpolant of its neighbours', () => {
  it('lies between the two surrounding samples', () => {
    const signal = result.dataset.signals.get(ATTITUDE_SIGNAL_IDS.roll);
    const samples = signal?.samples ?? [];

    let checked = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const before = samples[index - 1];
      const after = samples[index];
      if (before === undefined || after === undefined) {
        continue;
      }

      const midpoint = (before.t_rel_seconds + after.t_rel_seconds) / 2;
      const value = playbackStateAt(result, midpoint).channels.get(ATTITUDE_SIGNAL_IDS.roll)?.value;
      if (value === undefined || !Number.isFinite(value)) {
        continue;
      }

      const low = Math.min(before.value, after.value);
      const high = Math.max(before.value, after.value);
      expect(value, `t=${String(midpoint)}`).toBeGreaterThanOrEqual(low - 1e-12);
      expect(value).toBeLessThanOrEqual(high + 1e-12);
      checked += 1;
    }

    expect(checked).toBeGreaterThan(10);
  });

  it('is the exact midpoint value across a linear segment', () => {
    // The commanded roll steps 2 -> 12 deg at t=2 and holds, so [2.0, 2.1] is flat and any pair
    // inside the ramped RMS region is linear between its own endpoints by construction.
    const signal = result.dataset.signals.get(ATTITUDE_SIGNAL_IDS.roll);
    const samples = signal?.samples ?? [];
    const before = samples[30];
    const after = samples[31];
    expect(before).toBeDefined();
    expect(after).toBeDefined();

    const midpoint = ((before?.t_rel_seconds ?? 0) + (after?.t_rel_seconds ?? 0)) / 2;
    const expected = ((before?.value ?? 0) + (after?.value ?? 0)) / 2;

    const value = playbackStateAt(result, midpoint).channels.get(ATTITUDE_SIGNAL_IDS.roll)?.value;

    expect(value).toBeCloseTo(expected, 12);
  });

  it('marks an interpolated reading INTERPOLATED, not VALID', () => {
    const samples = result.dataset.signals.get(ATTITUDE_SIGNAL_IDS.roll)?.samples ?? [];
    const midpoint = ((samples[10]?.t_rel_seconds ?? 0) + (samples[11]?.t_rel_seconds ?? 0)) / 2;

    const channel = playbackStateAt(result, midpoint).channels.get(ATTITUDE_SIGNAL_IDS.roll);

    expect(channel?.validity).toBe(Validity.INTERPOLATED);
  });
});

describe('where the log says nothing, playback says nothing', () => {
  it('has no position while the GNSS fix is lost', () => {
    // The fixture drops to fix type 1 for t=[3, 6).
    for (const t of [3.2, 4.0, 4.8, 5.6]) {
      const state = playbackStateAt(result, t);

      expect(state.position, `t=${String(t)} produced a position during the outage`).toBeNull();
    }
  });

  it('does not hold the last known fix across the outage', () => {
    const before = playbackStateAt(result, 2.8).position;
    const during = playbackStateAt(result, 4.5).position;

    expect(before).not.toBeNull();
    expect(during).toBeNull();
  });

  it('reports the position channels as not value-bearing rather than absent from the map', () => {
    const channel = playbackStateAt(result, 4.5).channels.get(POSITION_SIGNAL_IDS.latitude);

    expect(channel).toBeDefined();
    expect(channel?.validity).not.toBe(Validity.VALID);
    expect(Number.isNaN(channel?.value ?? 0)).toBe(true);
  });

  it('recovers the position once the fix returns', () => {
    expect(playbackStateAt(result, 6.4).position).not.toBeNull();
  });

  it('has nothing before the flight starts', () => {
    const state = playbackStateAt(result, -5);

    expect(state.position).toBeNull();
    expect(state.attitude).toBeNull();
  });

  it('has nothing after the flight ends', () => {
    const state = playbackStateAt(result, 500);

    expect(state.position).toBeNull();
    expect(state.attitude).toBeNull();
  });

  it('does not interpolate across a gap wider than the configured maximum', () => {
    // 4.55 s falls between two 10 Hz attitude samples. 4.50 would land exactly on one and be
    // returned as VALID, which would test nothing about gap handling.
    const tight = playbackStateAt(result, 4.55, { maxGapSeconds: 0.01 });
    const loose = playbackStateAt(result, 4.55, { maxGapSeconds: 60 });

    expect(tight.channels.get(ATTITUDE_SIGNAL_IDS.roll)?.validity).toBe(Validity.MISSING);
    expect(loose.channels.get(ATTITUDE_SIGNAL_IDS.roll)?.validity).toBe(Validity.INTERPOLATED);
  });

  it('marks a signal the vehicle never logged UNSUPPORTED, not MISSING', () => {
    const state = playbackStateAt(result, 1, { extraSignalIds: ['never.logged'] });

    expect(state.channels.get('never.logged')?.validity).toBe(Validity.UNSUPPORTED);
  });
});

describe('attitude is all three axes or none', () => {
  it('resolves when every axis is present', () => {
    expect(playbackStateAt(result, 1).attitude).not.toBeNull();
  });

  it('is null when an axis is missing, rather than filling it with zero', async () => {
    const noYaw = await load('gps-glitch.bin');
    const stripped = {
      dataset: {
        ...noYaw.dataset,
        signals: new Map(
          [...noYaw.dataset.signals].filter(([id]) => id !== ATTITUDE_SIGNAL_IDS.yaw),
        ),
      },
    };

    const state = playbackStateAt(stripped, 1);

    expect(state.attitude).toBeNull();
    expect(state.channels.get(ATTITUDE_SIGNAL_IDS.yaw)?.validity).toBe(Validity.UNSUPPORTED);
  });
});

describe('determinism (doc 03 §6)', () => {
  it('returns the same state for the same instant', () => {
    const a = playbackStateAt(result, 3.75);
    const b = playbackStateAt(result, 3.75);

    expect(JSON.stringify([...a.channels])).toBe(JSON.stringify([...b.channels]));
    expect(a.position).toEqual(b.position);
    expect(a.attitude).toEqual(b.attitude);
  });
});
