/**
 * The CLI as a function — doc 04 §1 rule 3.
 *
 * `runCli` takes its whole world as an argument: argv, a file reader, two output sinks and a clock.
 * That is what lets these tests exercise the real command path — parsing, pipeline, JSON emission
 * and exit code — with no process, no filesystem and no wall clock, and it is the same seam that
 * keeps the wall-clock timestamp out of the golden fixture in `golden.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLI_VERSION, EXIT, runCli, type CliEnvironment } from '@pandalog/cli';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

interface Capture {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(argv: string[], overrides: Partial<CliEnvironment> = {}): Promise<Capture> {
  let stdout = '';
  let stderr = '';

  const environment: CliEnvironment = {
    argv,
    readFile: (file: string) =>
      Promise.resolve(new Uint8Array(readFileSync(path.join(FIXTURES, file)))),
    stdout: (text: string) => {
      stdout += text;
    },
    stderr: (text: string) => {
      stderr += text;
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };

  return { exitCode: await runCli(environment), stdout, stderr };
}

describe('pandalog verify', () => {
  it('emits JSON on stdout and the human summary on stderr, so redirection works', async () => {
    const { stdout, stderr } = await run(['verify', 'nominal.bin']);

    expect(() => JSON.parse(stdout) as unknown).not.toThrow();
    expect(stderr).not.toBe('');
  });

  it('exits 0 for a flight whose applicable requirements all passed', async () => {
    expect((await run(['verify', 'nominal.bin'])).exitCode).toBe(EXIT.OK);
  });

  it('exits non-zero for a flight with a failing requirement', async () => {
    expect((await run(['verify', 'mode-change-error.bin'])).exitCode).toBe(EXIT.FAIL);
  });

  it('exits non-zero when a requirement could not be concluded', async () => {
    expect((await run(['verify', 'gps-glitch.bin'])).exitCode).toBe(EXIT.INCONCLUSIVE);
  });

  it('records the exit code inside the JSON, for a consumer reading the file later', async () => {
    const { stdout, exitCode } = await run(['verify', 'mode-change-error.bin']);
    const parsed = JSON.parse(stdout) as { outcome: { exitCode: number } };

    expect(parsed.outcome.exitCode).toBe(exitCode);
  });

  it('carries the log digest, so a result can be tied back to the exact file', async () => {
    const { stdout } = await run(['verify', 'nominal.bin']);
    const parsed = JSON.parse(stdout) as { log: { sha256: string; fileName: string } };

    expect(parsed.log.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.log.fileName).toBe('nominal.bin');
  });

  it('names the requirement set and its provenance in the output', async () => {
    const { stdout } = await run(['verify', 'nominal.bin']);
    const parsed = JSON.parse(stdout) as {
      verification: { requirementSetId: string; requirementSetSource: string };
    };

    expect(parsed.verification.requirementSetId).toBe('pandalog-provisional');
    expect(parsed.verification.requirementSetSource).toBe('provisional');
  });

  it('warns on stderr that the requirement set is provisional', async () => {
    const { stderr } = await run(['verify', 'nominal.bin']);

    expect(stderr.toLowerCase()).toContain('provisional');
  });

  it('silences the summary under --quiet but still emits the JSON', async () => {
    const { stdout, stderr } = await run(['verify', 'nominal.bin', '--quiet']);

    expect(stderr).toBe('');
    expect(stdout).not.toBe('');
  });

  it('is deterministic: two runs of one log produce identical stdout', async () => {
    const first = await run(['verify', 'gps-glitch.bin']);
    const second = await run(['verify', 'gps-glitch.bin']);

    expect(first.stdout).toBe(second.stdout);
  });
});

describe('failure handling', () => {
  it('reports a usage error without emitting JSON', async () => {
    const { exitCode, stdout, stderr } = await run(['analyse', 'f.bin']);

    expect(exitCode).toBe(EXIT.USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('analyse');
  });

  it('reports an unreadable file as an input error, not a crash', async () => {
    const { exitCode, stderr } = await run(['verify', 'nope.bin'], {
      readFile: () => Promise.reject(new Error('ENOENT: no such file')),
    });

    expect(exitCode).toBe(EXIT.INPUT);
    expect(stderr).toContain('ENOENT');
  });

  it('reports a log no adapter recognises as an input error', async () => {
    const { exitCode, stderr } = await run(['verify', 'notalog.bin'], {
      readFile: () => Promise.resolve(new TextEncoder().encode('this is not a dataflash log')),
    });

    expect(exitCode).toBe(EXIT.INPUT);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it('reports a broken stdout as an internal error, distinct from a failed flight', async () => {
    // What `pandalog verify f.bin | head -1` does: the reader closes and the write raises EPIPE.
    const { exitCode, stderr } = await run(['verify', 'nominal.bin'], {
      stdout: () => {
        throw new Error('EPIPE: broken pipe');
      },
    });

    expect(exitCode).toBe(EXIT.INTERNAL);
    expect(stderr).toContain('EPIPE');
  });

  it('never emits partial JSON on failure, so a consumer never parses half a result', async () => {
    const { stdout } = await run(['verify', 'notalog.bin'], {
      readFile: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    });

    expect(stdout).toBe('');
  });
});

describe('help and version', () => {
  it('prints usage on --help and exits 0', async () => {
    const { exitCode, stdout } = await run(['--help']);

    expect(exitCode).toBe(EXIT.OK);
    expect(stdout).toContain('pandalog verify');
  });

  it('documents what each exit code means, since CI depends on them', async () => {
    const { stdout } = await run(['--help']);

    for (const code of ['0', '1', '2', '64', '65']) {
      expect(stdout).toContain(code);
    }
  });

  it('prints the version on --version', async () => {
    const { exitCode, stdout } = await run(['--version']);

    expect(exitCode).toBe(EXIT.OK);
    expect(stdout.trim()).toBe(CLI_VERSION);
  });

  it('reports the version the package actually declares', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(FIXTURES, '..', '..', 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { version: string };

    expect(CLI_VERSION).toBe(manifest.version);
  });
});

describe('pandalog verify --format=markdown', () => {
  it('writes a report to stdout instead of the JSON document', async () => {
    const { exitCode, stdout } = await run(['verify', 'nominal.bin', '--format=markdown']);

    expect(exitCode).toBe(EXIT.OK);
    expect(stdout.startsWith('# Flight analysis')).toBe(true);
    // Not merely "different from JSON": a consumer redirecting stdout must get one document, and
    // markdown that happened to parse as JSON would mean the two formats had been mixed.
    expect(() => {
      JSON.parse(stdout);
    }).toThrow();
  });

  it('keeps the exit code the verification decided, whatever the format', async () => {
    // The format is a rendering choice. If it could change the exit code, a CI step that switched
    // to archiving reports would start passing builds it used to fail.
    for (const file of ['nominal.bin', 'degraded-flight.bin', 'mode-change-error.bin']) {
      const asJson = await run(['verify', file, '--quiet']);
      const asMarkdown = await run(['verify', file, '--quiet', '--format=markdown']);

      expect(asMarkdown.exitCode, file).toBe(asJson.exitCode);
    }
  });

  it('still prints the provisional-criteria warning to stderr', async () => {
    const { stderr } = await run(['verify', 'degraded-flight.bin', '--format=markdown']);

    expect(stderr).toContain('provisional');
  });

  it('produces byte-identical reports on two runs at the same instant', async () => {
    const first = await run(['verify', 'degraded-flight.bin', '--format=markdown']);
    const second = await run(['verify', 'degraded-flight.bin', '--format=markdown']);

    expect(first.stdout).toBe(second.stdout);
  });

  it('refuses a format it cannot produce rather than silently writing JSON', async () => {
    const { exitCode, stdout, stderr } = await run(['verify', 'nominal.bin', '--format=pdf']);

    expect(exitCode).toBe(EXIT.USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('pdf');
  });
});
