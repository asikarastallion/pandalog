#!/usr/bin/env node
/**
 * The Node entry point.
 *
 * Everything platform-specific is here and nowhere else: argv, the filesystem, the streams, the
 * wall clock, the exit call. It is intentionally too small to hold a bug, because it is the one
 * part of the CLI `run.test.ts` cannot exercise.
 */
import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { runCli } from './run.js';

const exitCode = await runCli({
  argv: process.argv.slice(2),
  readFile: async (path: string) => new Uint8Array(await readFile(path)),
  stdout: (text: string) => process.stdout.write(text),
  stderr: (text: string) => process.stderr.write(text),
  now: () => new Date(),
});

process.exitCode = exitCode;
