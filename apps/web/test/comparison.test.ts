/**
 * Wiring `@pandalog/comparison` into the workspace.
 *
 * The package has been complete since Phase J and reachable from nowhere, so what is tested here is
 * the wiring rather than the comparison — `packages/comparison` already holds the logic to seven
 * injected defects. Two properties matter at this boundary:
 *
 *   **A comparison that could not run is never a comparison that found nothing.** A missing
 *   baseline and a clean result must be distinguishable, which is the same distinction
 *   `INCONCLUSIVE` protects one stage upstream.
 *
 *   **`INCOMPARABLE` reaches the screen as itself.** ADR-0012 made it a first-class answer; the view
 *   is the one place a person reads the verdict, and collapsing it there would undo the decision
 *   where it counts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  baselineCandidates,
  comparisonAxes,
  runComparison,
  type RunLog,
} from '../src/workspace/comparison.js';
import type { LogStore, StoredLog, StoredLogSummary } from '../src/workspace/persistence.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const bytesOf = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(path.join(FIXTURES, name)));

const now = (): Date => new Date('2026-01-01T00:00:00.000Z');

const run: RunLog = (fileName, bytes) => runPipeline({ fileName, bytes, now });

let nominal: PipelineResult;
let degraded: PipelineResult;

beforeAll(async () => {
  [nominal, degraded] = await Promise.all([run('nominal.bin', bytesOf('nominal.bin')), run('degraded-flight.bin', bytesOf('degraded-flight.bin'))]);
});

const summary = (sha256: string, fileName: string): StoredLogSummary => ({
  sha256,
  fileName,
  sizeBytes: 1,
  analysedAtUtc: '2026-01-01T00:00:00.000Z',
  durationSeconds: 8,
  findingCount: 0,
  outcomes: { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, NOT_APPLICABLE: 0 },
});

/** A store holding exactly what a test puts in it. */
function storeOf(entries: readonly StoredLog[]): LogStore {
  return {
    list: () =>
      Promise.resolve(
        entries.map((entry) => {
          const { bytes, ...summaryOnly } = entry;
          void bytes;
          return summaryOnly;
        }),
      ),
    get: (sha256) => Promise.resolve(entries.find((entry) => entry.sha256 === sha256) ?? null),
    put: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  };
}

const storedNominal = (): StoredLog => {
  const bytes = bytesOf('nominal.bin');
  return {
    ...summary(nominal.dataset.provenance.sha256, 'nominal.bin'),
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
};

describe('choosing a baseline', () => {
  it('offers every stored log except the one that is open', () => {
    const stored = [summary('aaa', 'one.bin'), summary('bbb', 'two.bin')];

    // Comparing a flight against itself is Phase J's self-consistency test, not a question the UI
    // exists to answer.
    expect(baselineCandidates(stored, 'aaa').map((entry) => entry.sha256)).toEqual(['bbb']);
  });

  it('offers everything when no log is open', () => {
    expect(baselineCandidates([summary('aaa', 'one.bin')], null)).toHaveLength(1);
  });
});

describe('running a comparison', () => {
  it('compares the open flight against a stored one', async () => {
    const state = await runComparison({
      subject: degraded,
      subjectLabel: 'degraded-flight.bin',
      baselineSha256: nominal.dataset.provenance.sha256,
      store: storeOf([storedNominal()]),
      run,
      now,
    });

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') {
      return;
    }
    expect(state.report.baselineLabel).toBe('nominal.bin');
    expect(state.report.subjectLabel).toBe('degraded-flight.bin');
  });

  it('re-runs the baseline rather than trusting a cached verdict', async () => {
    // Doc 03 §6 makes the re-run byte-identical, so what the screen shows is what the code
    // currently concludes rather than what some earlier version concluded.
    let ran = 0;
    const counting: RunLog = (fileName, bytes) => {
      ran += 1;
      return run(fileName, bytes);
    };

    await runComparison({
      subject: degraded,
      subjectLabel: 'degraded-flight.bin',
      baselineSha256: nominal.dataset.provenance.sha256,
      store: storeOf([storedNominal()]),
      run: counting,
      now,
    });

    expect(ran).toBe(1);
  });

  it('reports all four axes doc 01 §3 names', async () => {
    const state = await runComparison({
      subject: degraded,
      subjectLabel: 'degraded-flight.bin',
      baselineSha256: nominal.dataset.provenance.sha256,
      store: storeOf([storedNominal()]),
      run,
      now,
    });
    if (state.status !== 'ready') {
      throw new Error(`Expected a ready comparison, got ${state.status}`);
    }

    expect(comparisonAxes(state.report).map((axis) => axis.name)).toEqual([
      'Signals',
      'Events',
      'Findings',
      'Verification',
    ]);
  });

  it('carries every verdict through as itself, INCOMPARABLE included', async () => {
    const state = await runComparison({
      subject: degraded,
      subjectLabel: 'degraded-flight.bin',
      baselineSha256: nominal.dataset.provenance.sha256,
      store: storeOf([storedNominal()]),
      run,
      now,
    });
    if (state.status !== 'ready') {
      throw new Error(`Expected a ready comparison, got ${state.status}`);
    }

    for (const axis of comparisonAxes(state.report)) {
      expect(['SAME', 'DIFFERENT', 'INCOMPARABLE']).toContain(axis.verdict);
      expect(axis.reason.length).toBeGreaterThan(0);
    }
    expect(['SAME', 'DIFFERENT', 'INCOMPARABLE']).toContain(state.report.verdict);
  });
});

describe('a comparison that could not run', () => {
  it('is a failure, not a clean result, when the baseline is gone', async () => {
    const state = await runComparison({
      subject: degraded,
      subjectLabel: 'degraded-flight.bin',
      baselineSha256: 'not-in-this-browser',
      store: storeOf([]),
      run,
      now,
    });

    expect(state.status).toBe('failed');
    if (state.status !== 'failed') {
      return;
    }
    expect(state.message).toContain('no longer in this browser');
  });

  it('is a failure, naming the cause, when the baseline will not decode', async () => {
    const corrupt: StoredLog = {
      ...summary('corrupt', 'corrupt.bin'),
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    };

    const state = await runComparison({
      subject: degraded,
      subjectLabel: 'degraded-flight.bin',
      baselineSha256: 'corrupt',
      store: storeOf([corrupt]),
      run,
      now,
    });

    expect(state.status).toBe('failed');
    if (state.status !== 'failed') {
      return;
    }
    // Verbatim from the domain package (doc 04 §4) rather than a generic apology.
    expect(state.message).toContain('could not be re-analysed');
    expect(state.message.length).toBeGreaterThan('could not be re-analysed'.length + 10);
  });
});
