/**
 * Argument parsing.
 *
 * Kept as a pure function over an argv array so the whole surface is testable without a process.
 * The one policy decision worth stating: bare `pandalog` is a usage *error*, not a help screen with
 * exit 0. A CLI meant for CI must not exit 0 for an invocation that verified nothing.
 */
import { describe, expect, it } from 'vitest';

import { parseArgs } from '@pandalog/cli';

describe('parseArgs', () => {
  it('parses a verify invocation', () => {
    expect(parseArgs(['verify', 'flight.bin'])).toEqual({
      kind: 'verify',
      file: 'flight.bin',
      quiet: false,
    });
  });

  it.each([
    [['--quiet', 'verify', 'f.bin']],
    [['verify', '--quiet', 'f.bin']],
    [['verify', 'f.bin', '--quiet']],
  ])('accepts --quiet anywhere in %j', (argv) => {
    expect(parseArgs(argv)).toEqual({ kind: 'verify', file: 'f.bin', quiet: true });
  });

  it.each([['--help'], ['-h'], ['help']])('treats %s as a help request', (flag) => {
    expect(parseArgs([flag]).kind).toBe('help');
  });

  it('treats --version as a version request', () => {
    expect(parseArgs(['--version']).kind).toBe('version');
  });

  describe('usage errors', () => {
    it('rejects an empty invocation rather than printing help and exiting 0', () => {
      expect(parseArgs([]).kind).toBe('usage-error');
    });

    it('rejects an unknown command, naming it', () => {
      const parsed = parseArgs(['analyse', 'f.bin']);

      expect(parsed.kind).toBe('usage-error');
      expect(parsed.kind === 'usage-error' && parsed.message).toContain('analyse');
    });

    it('rejects verify with no file', () => {
      expect(parseArgs(['verify']).kind).toBe('usage-error');
    });

    it('rejects an unknown flag, naming it', () => {
      const parsed = parseArgs(['verify', '--json', 'f.bin']);

      expect(parsed.kind).toBe('usage-error');
      expect(parsed.kind === 'usage-error' && parsed.message).toContain('--json');
    });

    it('rejects more than one log, rather than silently verifying the first', () => {
      const parsed = parseArgs(['verify', 'a.bin', 'b.bin']);

      expect(parsed.kind).toBe('usage-error');
      expect(parsed.kind === 'usage-error' && parsed.message).toContain('b.bin');
    });
  });
});
