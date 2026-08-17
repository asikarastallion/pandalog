// @vitest-environment happy-dom
/**
 * Dropping a file that is not a flight log.
 *
 * The question this file answers is the one a browser-only user actually cares about: **does the
 * page tell me what happened, or does it break?** Every case runs the real pipeline over real bytes
 * and then renders the real drop zone with the real failure, so nothing here is asserted against a
 * hand-written error object that happens to have the right shape.
 *
 * The cases are the ways a file arrives wrong in practice: empty, the wrong kind entirely, a
 * genuine log that was truncated mid-download, and one corrupted in the middle.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline } from '@pandalog/pipeline';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LogDropZone from '../src/components/LogDropZone.vue';
import { createWorkspace } from '../src/workspace/state.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const realLog = (): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURES, 'nominal.bin')));

const corruptedInTheMiddle = (): Uint8Array => {
  const bytes = realLog();
  for (let index = 300; index < Math.min(600, bytes.length); index += 1) {
    bytes[index] = 0xff;
  }
  return bytes;
};

const CASES: readonly (readonly [string, string, () => Uint8Array])[] = [
  ['an empty file', 'empty.bin', () => new Uint8Array(0)],
  [
    'a text file renamed .bin',
    'notes.bin',
    () => new TextEncoder().encode('not a log\n'.repeat(50)),
  ],
  [
    'a photo',
    'holiday.png',
    () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ],
  ['a log truncated mid-download', 'partial.bin', () => realLog().subarray(0, 40)],
  ['a log corrupted in the middle', 'damaged.bin', corruptedInTheMiddle],
  ['a file of zeroes', 'zeroes.bin', () => new Uint8Array(4096)],
];

/** Run the real pipeline and route the failure through the real store, as `App.vue` does. */
async function dropInto(fileName: string, bytes: Uint8Array) {
  const workspace = createWorkspace();
  workspace.beginLoad(fileName);
  try {
    workspace.setResult(
      fileName,
      await runPipeline({ fileName, bytes, now: () => new Date('2026-01-01T00:00:00.000Z') }),
    );
  } catch (error) {
    workspace.failLoad(fileName, error);
  }
  return workspace;
}

describe.each(CASES)('%s', (_label, fileName, makeBytes) => {
  it('fails rather than being partly accepted', async () => {
    const workspace = await dropInto(fileName, makeBytes());

    expect(workspace.load.value.status).toBe('failed');
    // Doc 04: a malformed log is never partially salvaged. A half-parsed dataset presented as a
    // flight is worse than a refusal, because nothing downstream can tell it is half.
    expect(workspace.result.value).toBeNull();
  });

  it('produces a message and a next step, both non-empty', async () => {
    const workspace = await dropInto(fileName, makeBytes());
    const state = workspace.load.value;
    if (state.status !== 'failed') {
      throw new Error(`${fileName} unexpectedly succeeded`);
    }

    expect(state.message.trim().length).toBeGreaterThan(0);
    expect(state.guidance.trim().length).toBeGreaterThan(0);
    expect(state.message).not.toContain('[object Object]');
    expect(state.message).not.toMatch(/undefined|NaN/);
  });

  it('renders that failure in the drop zone as an alert', async () => {
    const workspace = await dropInto(fileName, makeBytes());
    const state = workspace.load.value;

    const wrapper = mount(LogDropZone, { props: { state } });
    const alert = wrapper.find('[role="alert"]');

    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain(fileName);
    expect(alert.text()).toContain(state.status === 'failed' ? state.guidance : '');
  });

  it('still offers a way to try another file', async () => {
    // A dead end is its own kind of crash: the user has a failure on screen and no way forward
    // except reloading the page.
    const workspace = await dropInto(fileName, makeBytes());

    const wrapper = mount(LogDropZone, { props: { state: workspace.load.value } });

    expect(wrapper.find('input[type="file"]').exists()).toBe(true);
    expect(wrapper.text()).toMatch(/drop another log|Drop an ArduPilot/i);
  });
});

describe('a real log, for contrast', () => {
  it('opens and is not reported as a failure', async () => {
    // Without this, every assertion above would be satisfied by an app that refused everything.
    const workspace = await dropInto('nominal.bin', realLog());

    expect(workspace.load.value.status).toBe('ready');
    expect(workspace.result.value).not.toBeNull();
  });
});
