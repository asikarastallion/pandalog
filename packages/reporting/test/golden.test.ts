/**
 * Golden reports.
 *
 * The reproducibility tests prove two runs agree with *each other*, which a renderer emitting a
 * fixed skeleton would also satisfy. These pin what the report actually says, so a change to any
 * stage that alters a severity, a threshold basis, an outcome or a comparison verdict shows up as a
 * reviewable diff in a file rather than as a silently different report.
 *
 * The goldens live beside the log they describe, in the same directory and under the same naming
 * convention as the events, verification and CLI goldens.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildReport, renderMarkdown } from '@pandalog/reporting';

import { comparingInput, inputFor } from './support/artifacts.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

/** `UPDATE_GOLDENS=1 pnpm test` rewrites them; the diff is then reviewed like any other change. */
function checkGolden(name: string, actual: string): void {
  const file = path.join(FIXTURES, name);
  if (process.env.UPDATE_GOLDENS === '1') {
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, 'utf8'));
}

describe('golden report', () => {
  it('matches for a degraded flight', async () => {
    const markdown = renderMarkdown(buildReport(await inputFor('degraded-flight.bin')));

    checkGolden('degraded-flight.report.md', markdown);
  });

  it('matches for a nominal flight, which raises no findings of its own', async () => {
    const markdown = renderMarkdown(buildReport(await inputFor('nominal.bin')));

    checkGolden('nominal.report.md', markdown);
  });

  it('matches for a flight compared against a baseline', async () => {
    const markdown = renderMarkdown(
      buildReport(await comparingInput('nominal.bin', 'degraded-flight.bin')),
    );

    checkGolden('nominal-vs-degraded.report.md', markdown);
  });
});
