/**
 * Access to the committed golden fixtures.
 *
 * Kept local to this package rather than borrowed from `tests/architecture`, so a package's tests
 * depend only on the package and its own support code.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** packages/parser-ardupilot/test/support -> repository root */
export const FIXTURE_DIR = path.resolve(HERE, '..', '..', '..', '..', 'fixtures', 'ardupilot');

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
}

export function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name);
}
