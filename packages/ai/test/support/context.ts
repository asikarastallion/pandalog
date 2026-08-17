/** A context built from real fixture bytes, so grounding is tested against real artifacts. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareFlights } from '@pandalog/comparison';
import { runPipeline, type PipelineResult } from '@pandalog/pipeline';

import { buildAiContext, type AiContext } from '@pandalog/ai';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const now = (): Date => new Date('2026-01-01T00:00:00.000Z');

export const runFixture = async (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now,
  });

export async function contextFor(name = 'degraded-flight.bin'): Promise<AiContext> {
  const result = await runFixture(name);
  return buildAiContext(result);
}

export async function comparingContext(
  baselineName = 'nominal.bin',
  subjectName = 'degraded-flight.bin',
): Promise<AiContext> {
  const [baseline, subject] = await Promise.all([
    runFixture(baselineName),
    runFixture(subjectName),
  ]);
  const comparison = compareFlights({
    baseline: { label: baselineName, ...baseline },
    subject: { label: subjectName, ...subject },
    now,
  });
  return buildAiContext({ ...subject, comparison });
}

/** A client that returns whatever a test tells it to, so no network is involved. */
export const clientReturning = (body: string) => ({
  model: 'test-model',
  complete: () => Promise.resolve(body),
});

/** A model answer as JSON, with every field defaulted to empty. */
export const answerJson = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    facts: [],
    hypotheses: [],
    uncertainties: [],
    evidenceRefs: [],
    recommendedChecks: [],
    ...fields,
  });
