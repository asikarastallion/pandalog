// @vitest-environment happy-dom
/**
 * Saying what a long decode is doing.
 *
 * A real flight log is tens of megabytes and millions of samples, and the workspace previously said
 * only "Analysing…" for however long that took. The fix has one constraint worth testing: **stages,
 * never a percentage.** How long each stage takes depends on what the log contains — a log with no
 * GNSS spends no time detecting fix loss — so a bar would be a number the app invented about its
 * own progress rather than measured, which is the same objection doc 04 §7 makes to an invented
 * quantity in a report.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIPELINE_STAGES, runPipeline, type PipelineStage } from '@pandalog/pipeline';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LogDropZone from '../src/components/LogDropZone.vue';
import { STAGES, STAGE_LABELS } from '../src/workspace/stages.js';
import { createWorkspace } from '../src/workspace/state.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

describe('the pipeline reports its stages', () => {
  it('announces each one, in order, exactly once', async () => {
    const seen: PipelineStage[] = [];

    await runPipeline({
      fileName: 'degraded-flight.bin',
      bytes: bytes('degraded-flight.bin'),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      onStage: (stage) => seen.push(stage),
    });

    expect(seen).toEqual([...PIPELINE_STAGES]);
  });

  it('computes the same result whether or not anybody is listening', async () => {
    // Observation must not become participation: a run with a listener has to be the run without
    // one, or the progress display would be changing what the analysis concluded.
    const input = {
      fileName: 'degraded-flight.bin',
      bytes: bytes('degraded-flight.bin'),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    };

    const [silent, watched] = await Promise.all([
      runPipeline(input),
      runPipeline({ ...input, onStage: () => undefined }),
    ]);

    expect(watched.findings).toEqual(silent.findings);
    expect(watched.verification).toEqual(silent.verification);
  });

  it('announces a stage before that stage has produced anything', async () => {
    // "ingesting" must arrive before the dataset exists, or the label lags the work it describes.
    let firstStage: PipelineStage | null = null;

    await runPipeline({
      fileName: 'nominal.bin',
      bytes: bytes('nominal.bin'),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      onStage: (stage) => {
        firstStage ??= stage;
      },
    });

    expect(firstStage).toBe('ingesting');
  });
});

describe('the workspace holds the stage', () => {
  it('starts a load with no stage yet rather than guessing one', () => {
    const workspace = createWorkspace();
    workspace.beginLoad('x.bin');

    expect(workspace.load.value).toEqual({ status: 'loading', fileName: 'x.bin', stage: null });
  });

  it('records each stage as it is reported', () => {
    const workspace = createWorkspace();
    workspace.beginLoad('x.bin');
    workspace.reportStage('analysing');

    expect(workspace.load.value).toMatchObject({ status: 'loading', stage: 'analysing' });
  });

  it('ignores a stage arriving after the load finished', () => {
    // A superseded run's message must not put a finished workspace back into a loading state.
    const workspace = createWorkspace();
    workspace.beginLoad('x.bin');
    workspace.failLoad('x.bin', new Error('nope'));
    workspace.reportStage('verifying');

    expect(workspace.load.value.status).toBe('failed');
  });

  it('ignores a stage when nothing is loading at all', () => {
    const workspace = createWorkspace();
    workspace.reportStage('ingesting');

    expect(workspace.load.value).toEqual({ status: 'empty' });
  });
});

describe('the stage labels', () => {
  it('live in workspace/, because a component may not import a value from the pipeline', () => {
    // ui-boundary.test.ts enforces doc 04 §1 rule 1 and caught this on the first attempt.
    // The ordering is the pipeline's fact; a component reproducing the list would be a second copy
    // of it, free to drift the day a stage is added.
    expect([...STAGES]).toEqual([...PIPELINE_STAGES]);
  });

  it('names every stage the pipeline reports, and no stage it does not', () => {
    expect(Object.keys(STAGE_LABELS).sort()).toEqual([...PIPELINE_STAGES].sort());
  });
});

describe('what the screen says', () => {
  const mountAt = (stage: PipelineStage | null) =>
    mount(LogDropZone, {
      props: { state: { status: 'loading', fileName: 'flight.bin', stage } },
    });

  it('lists every stage, so the ones still to come are visible', () => {
    const text = mountAt('detecting-events').text();

    expect(text).toContain('Decoding the log into the canonical model');
    expect(text).toContain('Detecting flight events');
    expect(text).toContain('Running the analysis rules');
    expect(text).toContain('Verifying against the requirement set');
  });

  it('marks the current stage and the ones already done', () => {
    const wrapper = mountAt('analysing');

    expect(wrapper.findAll('.stages li.done')).toHaveLength(2);
    expect(wrapper.findAll('.stages li.current')).toHaveLength(1);
    expect(wrapper.find('.stages li.current').text()).toBe('Running the analysis rules');
  });

  it('shows a count of stages, never a percentage', () => {
    const text = mountAt('verifying').text();

    expect(text).toContain('Stage 4 of 4');
    expect(text).not.toContain('%');
  });

  it('says it is starting rather than claiming a stage before one is reported', () => {
    const wrapper = mountAt(null);

    expect(wrapper.text()).toContain('Starting…');
    expect(wrapper.findAll('.stages li.current')).toHaveLength(0);
    expect(wrapper.findAll('.stages li.done')).toHaveLength(0);
  });
});
