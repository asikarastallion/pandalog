/**
 * Golden CLI output — 05_IMPLEMENTATION_ROADMAP.md Phase G acceptance:
 *
 * > Full ingest→analyze→verify path runs against a golden fixture with no `apps/web` involved,
 * > producing output that matches a golden CLI-output fixture.
 *
 * This is the whole product as a user in CI meets it: bytes in, one JSON document and one exit code
 * out. The package-level goldens localise a regression to a stage; this one proves the stages are
 * still wired to each other.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLI_VERSION, runCli, type CliEnvironment } from '@pandalog/cli';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

function environmentFor(name: string, sink: { stdout: string; stderr: string }): CliEnvironment {
  return {
    argv: ['verify', name],
    readFile: (file: string) =>
      Promise.resolve(new Uint8Array(readFileSync(path.join(FIXTURES, file)))),
    stdout: (text: string) => {
      sink.stdout += text;
    },
    stderr: (text: string) => {
      sink.stderr += text;
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe.each([
  ['nominal.bin', 0],
  ['gps-glitch.bin', 2],
  ['mode-change-error.bin', 1],
])('pandalog verify %s', (name, expectedExit) => {
  it('produces the expected CLI output', async () => {
    const sink = { stdout: '', stderr: '' };
    await runCli(environmentFor(name, sink));

    await expect(sink.stdout).toMatchFileSnapshot(
      path.join(FIXTURES, `${name.replace(/\.bin$/, '')}.cli.json`),
    );
  });

  it(`exits ${String(expectedExit)}`, async () => {
    const sink = { stdout: '', stderr: '' };

    expect(await runCli(environmentFor(name, sink))).toBe(expectedExit);
  });

  it('stamps the tool version, so an old result is identifiable later', async () => {
    const sink = { stdout: '', stderr: '' };
    await runCli(environmentFor(name, sink));

    const parsed = JSON.parse(sink.stdout) as { tool: { name: string; version: string } };
    expect(parsed.tool).toEqual({ name: 'pandalog', version: CLI_VERSION });
  });
});
