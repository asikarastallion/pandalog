/**
 * The Worker boundary — doc 05 Phase H ("heavy work delegated to Web Workers").
 *
 * There is a trap here worth naming. `Signal.samples` is a Proxy over typed-array storage (doc 02
 * §4), and a Proxy is not structured-cloneable: handing a `PipelineResult` straight to
 * `postMessage` either throws or, worse, transfers the Proxy's empty target and delivers a dataset
 * whose signals all appear to have no samples. A UI built on that would render blank plots for a
 * flight that parsed perfectly, and nothing would report an error.
 *
 * So the result crosses the boundary as columns and is rebuilt on the other side. These tests are
 * the guarantee that the rebuild is lossless — they run without a Worker, because the encoding is a
 * pure function and the failure mode is data loss rather than concurrency.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { Validity } from '@pandalog/schema';

import { decodeResult, encodeResult } from '../src/workers/transfer.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const roundTrip = (result: PipelineResult): PipelineResult => decodeResult(encodeResult(result));

describe.each(['degraded-flight.bin', 'gps-glitch.bin'])('%s survives the boundary', (name) => {
  let original: PipelineResult;
  let restored: PipelineResult;

  beforeAll(async () => {
    original = await runPipeline({
      fileName: name,
      bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    restored = roundTrip(original);
  });

  it('keeps every signal', () => {
    expect([...restored.dataset.signals.keys()].sort()).toEqual(
      [...original.dataset.signals.keys()].sort(),
    );
  });

  it('keeps every sample — the failure this file exists to prevent', () => {
    for (const [id, signal] of original.dataset.signals) {
      expect(restored.dataset.signals.get(id)?.samples.length, `${id} lost samples`).toBe(
        signal.samples.length,
      );
    }
  });

  it('keeps sample values and times exactly, including NaN', () => {
    for (const [id, signal] of original.dataset.signals) {
      const other = restored.dataset.signals.get(id);
      signal.samples.forEach((sample, index) => {
        const copy = other?.samples[index];
        expect(copy?.t_rel_seconds, `${id}[${String(index)}] time`).toBe(sample.t_rel_seconds);
        expect(
          Number.isNaN(sample.value) ? Number.isNaN(copy?.value ?? 0) : copy?.value,
          `${id}[${String(index)}] value`,
        ).toStrictEqual(Number.isNaN(sample.value) ? true : sample.value);
      });
    }
  });

  it('keeps validity, so an UNSUPPORTED sample does not arrive as VALID', () => {
    for (const [id, signal] of original.dataset.signals) {
      const other = restored.dataset.signals.get(id);
      signal.samples.forEach((sample, index) => {
        expect(other?.samples[index]?.validity, `${id}[${String(index)}] validity`).toBe(
          sample.validity,
        );
      });
    }
  });

  it('keeps signal metadata: unit, source unit and derivation', () => {
    for (const [id, signal] of original.dataset.signals) {
      const other = restored.dataset.signals.get(id);
      expect(other?.unit).toBe(signal.unit);
      expect(other?.sourceUnit).toBe(signal.sourceUnit);
      expect(other?.derived).toBe(signal.derived);
    }
  });

  it('keeps provenance, so the restored dataset still names its log', () => {
    expect(restored.dataset.provenance).toEqual(original.dataset.provenance);
    expect(restored.dataset.vehicle).toEqual(original.dataset.vehicle);
    expect(restored.dataset.timeBase).toEqual(original.dataset.timeBase);
  });

  it('keeps events, findings and the verification report byte-for-byte', () => {
    expect(JSON.stringify(restored.events)).toBe(JSON.stringify(original.events));
    expect(JSON.stringify(restored.findings)).toBe(JSON.stringify(original.findings));
    expect(JSON.stringify(restored.verification)).toBe(JSON.stringify(original.verification));
  });

  it('produces a payload that structuredClone accepts', () => {
    // The real check that this can cross a postMessage boundary at all.
    expect(() => structuredClone(encodeResult(original))).not.toThrow();
  });
});

describe('the encoded payload', () => {
  it('carries typed arrays, so transferring it does not copy the samples', async () => {
    const result = await runPipeline({
      fileName: 'nominal.bin',
      bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'nominal.bin'))),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const [signal] = encodeResult(result).signals;

    expect(signal?.t).toBeInstanceOf(Float64Array);
    expect(signal?.values).toBeInstanceOf(Float64Array);
    expect(signal?.validity).toBeInstanceOf(Uint8Array);
  });

  it('round-trips an UNSUPPORTED signal, the case a naive copy gets wrong', async () => {
    const result = await runPipeline({
      fileName: 'gps-glitch.bin',
      bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'gps-glitch.bin'))),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const restored = roundTrip(result);
    const vibration = restored.dataset.signals.get('vibration.x');

    expect(vibration?.samples[0]?.validity).toBe(Validity.UNSUPPORTED);
    expect(Number.isNaN(vibration?.samples[0]?.value ?? 0)).toBe(true);
  });
});
