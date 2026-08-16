/**
 * `@pandalog/schema` purity — 02_CANONICAL_DATA_MODEL.md §3 invariant 4,
 * 01_SYSTEM_ARCHITECTURE.md §4.
 *
 * Doc 02 §3 names the enforcement for invariant 4 as "TypeScript `readonly` + architecture test
 * forbidding mutation helpers in `packages/schema`". This is that test. It is the reason the
 * runtime validator does not attempt a freeze check: the guarantee is that no mutator exists to
 * call, not that a particular object happens to be frozen.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as schema from '@pandalog/schema';

import { REPO_ROOT } from './manifest.js';

const MUTATOR_PREFIXES = [
  'set',
  'add',
  'remove',
  'delete',
  'push',
  'insert',
  'update',
  'mutate',
  'assign',
  'clear',
  'sort',
  'reverse',
  'splice',
  'write',
  'patch',
];

describe('@pandalog/schema stays a pure model package', () => {
  it('exports no mutation helper', () => {
    const offenders = Object.keys(schema).filter((name) =>
      MUTATOR_PREFIXES.some(
        (prefix) => name.toLowerCase().startsWith(prefix) && name.length > prefix.length,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('exports only types, guards, constants and the validator', () => {
    // Every exported function must be a predicate (is*), a validator (validate*), or a constant.
    // Anything else is behaviour creeping into layer 0.
    const functionExports = Object.entries(schema)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);

    for (const name of functionExports) {
      expect(name, `${name} is not a guard or validator`).toMatch(/^(is|validate)[A-Z]/);
    }
  });

  it('declares zero runtime dependencies', () => {
    const manifestPath = path.join(REPO_ROOT, 'packages', 'schema', 'package.json');
    const packageJson = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies ?? {}).toEqual({});
    expect(packageJson.peerDependencies ?? {}).toEqual({});
  });

  it('keeps the value-bearing validity set as the single expression of invariants 1a/1b', () => {
    expect([...schema.VALUE_BEARING_VALIDITIES].sort()).toEqual(['INTERPOLATED', 'VALID']);
  });
});
