/**
 * The pipeline composition — doc 01 §2.
 *
 * Doc 01 §2 says `apps/web` and `@pandalog/cli` "differ only in how they invoke the core pipeline
 * and where they read files from, not in what the pipeline does". These tests pin the invocation
 * itself: which detectors, which rules, which requirement set, and that every stage's output is
 * handed to the next rather than recomputed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runPipeline } from '@pandalog/pipeline';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const now = () => new Date('2026-01-01T00:00:00.000Z');

const load = (name: string) =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now,
  });

describe('runPipeline', () => {
  it('carries a log from bytes to verification outcomes in one call', async () => {
    const result = await load('nominal.bin');

    expect(result.dataset.signals.size).toBeGreaterThan(0);
    expect(result.verification.results.length).toBeGreaterThan(0);
  });

  it('stamps provenance from the file it was actually given', async () => {
    const result = await load('nominal.bin');

    expect(result.dataset.provenance.fileName).toBe('nominal.bin');
    expect(result.dataset.provenance.format).toBe('ardupilot-dataflash');
  });

  it('feeds detected events into analysis rather than re-deriving them', async () => {
    const result = await load('mode-change-error.bin');
    const eventIds = new Set(result.events.map((event) => event.id));

    const cited = result.verification.results
      .flatMap((outcome) => outcome.evidence)
      .filter((ref) => ref.kind === 'event')
      .map((ref) => ref.eventId);

    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) {
      expect(eventIds, `evidence cites ${id}, which is not an event this run produced`).toContain(
        id,
      );
    }
  });

  it('verifies against the provisional set until a real one is supplied', async () => {
    const result = await load('nominal.bin');

    expect(result.verification.requirementSetSource).toBe('provisional');
  });

  it('is deterministic across repeated runs of one log (doc 03 §6)', async () => {
    const [first, second] = await Promise.all([load('gps-glitch.bin'), load('gps-glitch.bin')]);

    expect(JSON.stringify(first.verification)).toBe(JSON.stringify(second.verification));
    expect(JSON.stringify(first.findings)).toBe(JSON.stringify(second.findings));
  });

  it('rejects a file no adapter recognises instead of guessing', async () => {
    await expect(
      runPipeline({ fileName: 'x.bin', bytes: new Uint8Array([1, 2, 3]), now }),
    ).rejects.toThrow();
  });
});
