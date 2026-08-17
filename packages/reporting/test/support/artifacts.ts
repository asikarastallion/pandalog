/** Report inputs built from real fixture bytes, so the renderer sees what the pipeline produces. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareFlights, type ComparisonReport } from '@pandalog/comparison';
import { runPipeline, type PipelineResult } from '@pandalog/pipeline';

import type { ReportInput } from '@pandalog/reporting';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

export const NOW = '2026-01-01T00:00:00.000Z';
export const now = (): Date => new Date(NOW);

export const clockAt = (iso: string) => (): Date => new Date(iso);

export const runFixture = async (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now,
  });

/** A report input for one flight, with no comparison. */
export async function inputFor(
  name: string,
  overrides: Partial<ReportInput> = {},
): Promise<ReportInput> {
  const result = await runFixture(name);
  return { ...result, now, ...overrides };
}

/** A report input comparing two fixtures. */
export async function comparingInput(
  baselineName: string,
  subjectName: string,
): Promise<ReportInput> {
  const [baseline, subject] = await Promise.all([
    runFixture(baselineName),
    runFixture(subjectName),
  ]);

  const comparison: ComparisonReport = compareFlights({
    baseline: { label: baselineName, ...baseline },
    subject: { label: subjectName, ...subject },
    now,
  });

  return { ...subject, comparison, now };
}
