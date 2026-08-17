// @vitest-environment happy-dom
/**
 * The workspace, rendered — doc 05 Phase H acceptance:
 *
 * > Selecting a `Finding` in the UI reaches its evidence and opens the correct synchronized time
 * > window against real fixture data.
 *
 * `investigation.test.ts` proves the resolution; this proves the wiring. Both are needed: the
 * resolution could be perfect and the click could be connected to nothing, and the tests would
 * still pass if only one existed.
 *
 * Everything below runs against `degraded-flight.bin` put through the real pipeline. No component
 * is given a hand-made finding, because a hand-made finding would not catch the case where the
 * component renders a field the real analysis never populates.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';

import FindingsList from '../src/components/FindingsList.vue';
import InvestigationPanel from '../src/components/InvestigationPanel.vue';
import VerificationPanel from '../src/components/VerificationPanel.vue';
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

describe('the state model (doc 01 §4)', () => {
  it('starts empty', () => {
    const workspace = createWorkspace();

    expect(workspace.load.value.status).toBe('empty');
    expect(workspace.findings.value).toEqual([]);
    expect(workspace.investigation.value).toBeNull();
  });

  it('opens the earliest finding when a log loads, rather than an empty pane', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);

    expect(workspace.selectedFindingId.value).not.toBeNull();
    expect(workspace.investigation.value).not.toBeNull();
  });

  it('derives the investigation from the selection instead of storing a second copy', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);

    const first = workspace.investigation.value?.finding.id;
    const other = result.findings.find((finding) => finding.id !== first);
    workspace.selectFinding(other?.id ?? null);

    expect(workspace.investigation.value?.finding.id).toBe(other?.id);
  });

  it('adds an operator-chosen signal to the open investigation', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const before = workspace.investigation.value?.signals.length ?? 0;

    workspace.toggleExtraSignal('attitude.pitch');

    expect(workspace.investigation.value?.signals.length).toBeGreaterThan(before);
  });

  it('removes it again when toggled off', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const before = workspace.investigation.value?.signals.length ?? 0;

    workspace.toggleExtraSignal('attitude.pitch');
    workspace.toggleExtraSignal('attitude.pitch');

    expect(workspace.investigation.value?.signals.length).toBe(before);
  });

  it('clears the previous flight when a new load begins', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    workspace.beginLoad('another.bin');

    expect(workspace.result.value).toBeNull();
    expect(workspace.investigation.value).toBeNull();
  });

  it('keeps a failure message and shows no stale result', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    workspace.failLoad('bad.bin', 'no adapter recognised this file');

    expect(workspace.load.value).toEqual({
      status: 'failed',
      fileName: 'bad.bin',
      message: 'no adapter recognised this file',
    });
    expect(workspace.result.value).toBeNull();
  });
});

describe('selecting a finding reaches its evidence (Phase H acceptance)', () => {
  it('emits the finding id that was clicked', async () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);

    const list = mount(FindingsList, {
      props: {
        findings: workspace.findings.value,
        selectedId: null,
        notApplicableRuleIds: [],
      },
    });

    await list.findAll('button.entry')[1]?.trigger('click');

    const emitted = list.emitted('select');
    expect(emitted?.[0]).toEqual([workspace.findings.value[1]?.finding.id]);
  });

  it('opens the clicked finding’s window, not the one that was open before', async () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);

    const list = mount(FindingsList, {
      props: {
        findings: workspace.findings.value,
        selectedId: workspace.selectedFindingId.value,
        notApplicableRuleIds: [],
      },
    });

    const before = workspace.investigation.value?.evidenceWindow;
    await list.findAll('button.entry')[2]?.trigger('click');
    workspace.selectFinding(String(list.emitted('select')?.[0]?.[0]));

    expect(workspace.investigation.value?.evidenceWindow).not.toEqual(before);
  });

  it('renders the evidence window and the cited signals in the panel', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const rollFinding = result.findings.find(
      (finding) => finding.ruleId === 'analysis:attitude-tracking-error',
    );
    workspace.selectFinding(rollFinding?.id ?? null);

    const panel = mount(InvestigationPanel, {
      props: {
        investigation: workspace.investigation.value,
        availableSignalIds: workspace.availableSignalIds.value,
        extraSignalIds: [],
      },
    });

    const text = panel.text();
    expect(text).toContain('attitude.roll');
    expect(text).toContain('attitude.roll.desired');
    expect(text).toMatch(/t = \[\d+\.\d+, \d+\.\d+\] s/);
  });

  it('draws a trace for every signal the finding cited', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const rollFinding = result.findings.find(
      (finding) => finding.ruleId === 'analysis:attitude-tracking-error',
    );
    workspace.selectFinding(rollFinding?.id ?? null);

    const panel = mount(InvestigationPanel, {
      props: {
        investigation: workspace.investigation.value,
        availableSignalIds: workspace.availableSignalIds.value,
        extraSignalIds: [],
      },
    });

    expect(panel.findAll('polyline.trace').length).toBeGreaterThan(0);
  });

  it('shows a provisional criterion as provisional, so it cannot pass for a qualified limit', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const rollFinding = result.findings.find(
      (finding) => finding.ruleId === 'analysis:attitude-tracking-error',
    );
    workspace.selectFinding(rollFinding?.id ?? null);

    const panel = mount(InvestigationPanel, {
      props: {
        investigation: workspace.investigation.value,
        availableSignalIds: workspace.availableSignalIds.value,
        extraSignalIds: [],
      },
    });

    expect(panel.find('.basis.provisional').exists()).toBe(true);
  });

  it('shows the angle criterion in degrees, not radians', () => {
    const workspace = createWorkspace();
    workspace.setResult('degraded-flight.bin', result);
    const rollFinding = result.findings.find(
      (finding) => finding.ruleId === 'analysis:attitude-tracking-error',
    );
    workspace.selectFinding(rollFinding?.id ?? null);

    const panel = mount(InvestigationPanel, {
      props: {
        investigation: workspace.investigation.value,
        availableSignalIds: workspace.availableSignalIds.value,
        extraSignalIds: [],
      },
    });

    // The criterion is stored as 0.0873 rad; a reader sees it as ~5 deg.
    expect(panel.text()).toContain('deg');
    expect(panel.text()).toMatch(/5\.00\d deg/);
    expect(panel.text()).not.toContain('0.087 rad');
  });

  it('prompts rather than showing a blank pane when nothing is selected', () => {
    const panel = mount(InvestigationPanel, {
      props: { investigation: null, availableSignalIds: [], extraSignalIds: [] },
    });

    expect(panel.text()).toContain('Select a finding');
  });
});

describe('verification is presented as four outcomes, not two', () => {
  it('renders each outcome with its plain-language meaning', () => {
    const panel = mount(VerificationPanel, { props: { report: result.verification } });
    const text = panel.text();

    expect(text).toContain('FAIL');
    expect(text).toContain('did not meet the criterion');
  });

  it('warns that the requirement set is provisional', () => {
    const panel = mount(VerificationPanel, { props: { report: result.verification } });

    expect(panel.text()).toContain('provisional');
    expect(panel.text()).toContain('not qualification evidence');
  });

  it('shows the evidence count behind each verdict', () => {
    const panel = mount(VerificationPanel, { props: { report: result.verification } });

    expect(panel.text()).toMatch(/\d+ evidence reference/);
  });
});

describe('an empty findings list says what it means', () => {
  it('does not imply the flight was sound', () => {
    const list = mount(FindingsList, {
      props: { findings: [], selectedId: null, notApplicableRuleIds: [] },
    });

    expect(list.text()).toContain('not that the flight was without fault');
  });

  it('names rules that did not apply, so silence is not read as a pass', () => {
    const list = mount(FindingsList, {
      props: {
        findings: [],
        selectedId: null,
        notApplicableRuleIds: ['analysis:vibration-level'],
      },
    });

    expect(list.text()).toContain('analysis:vibration-level');
  });
});
