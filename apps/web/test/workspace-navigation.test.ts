/**
 * One clock, one selection, shared by every view — doc 01 §5.1 rule 3.
 *
 * The regression this guards is subtle and would be easy to introduce: a view that resets the clock
 * or the selection when it opens. It looks like tidy initialisation and it silently breaks the
 * thing that makes a multi-view workspace usable — that a finding, an instant and a map position
 * are all describing the same moment.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';

import { VIEW_IDS } from '../src/workspace/navigation.js';
import { createWorkspace } from '../src/workspace/state.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

let result: PipelineResult;

beforeAll(async () => {
  result = await runPipeline({
    fileName: 'degraded-flight.bin',
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'degraded-flight.bin'))),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
});

describe('switching view', () => {
  it('never moves the clock', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    workspace.seek(4.2);

    for (const view of VIEW_IDS) {
      workspace.showView(view);
      expect(workspace.playbackTime.value, view).toBeCloseTo(4.2, 6);
    }
  });

  it('never changes the selected finding', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const chosen = workspace.findings.value[1]?.finding.id;
    expect(chosen).toBeDefined();
    workspace.selectFinding(chosen ?? null);

    for (const view of VIEW_IDS) {
      workspace.showView(view);
      expect(workspace.selectedFindingId.value, view).toBe(chosen);
    }
  });

  it('never changes the signals chosen for plotting', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const signalId = workspace.availableSignalIds.value[0] ?? '';
    workspace.toggleExtraSignal(signalId);

    for (const view of VIEW_IDS) {
      workspace.showView(view);
      expect([...workspace.extraSignalIds.value], view).toContain(signalId);
    }
  });

  it('describes the same instant in every view that reads the clock', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    workspace.seek(4.2);

    // Playback state and the 3D trajectory are read by different views; both must be describing
    // t = 4.2, not each their own idea of "now".
    expect(workspace.playback.value?.tSeconds).toBeCloseTo(4.2, 6);
    expect(workspace.trajectory.value).not.toBeNull();
  });
});

describe('opening a finding', () => {
  it('lands on the view that explains it', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const chosen = workspace.findings.value[0]?.finding.id ?? '';

    workspace.showView('summary');
    workspace.investigate(chosen);

    expect(workspace.activeView.value).toBe('investigation');
    expect(workspace.selectedFindingId.value).toBe(chosen);
  });

  it('does not disturb the clock while doing so', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    workspace.seek(3.1);

    workspace.investigate(workspace.findings.value[0]?.finding.id ?? '');

    expect(workspace.playbackTime.value).toBeCloseTo(3.1, 6);
  });
});

describe('opening a different log', () => {
  it('returns to the default view rather than leaving a stale one open', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    workspace.showView('report');

    workspace.beginLoad('another.bin');

    expect(workspace.activeView.value).toBe('summary');
  });
});
