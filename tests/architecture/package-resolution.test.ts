/**
 * A package's `tsconfig.json` references match the dependencies it declares.
 *
 * `web-resolution.test.ts` exists because a dependency added to `apps/web`'s `package.json` without
 * the matching path mapping still resolved locally, through a `dist` that only exists on a machine
 * that has built before. This is the same bug class one level down, and it was found the same way:
 * adding `@pandalog/events` to `@pandalog/reporting` typechecked and tested green, and failed in
 * `tsc -b`, because a composite project can only see a package it holds a project reference to.
 *
 * Both halves of the drift matter, so both are checked:
 *
 *   - a **dependency without a reference** is the failure above — green until the build runs;
 *   - a **reference without a dependency** is a package importing something its own manifest does
 *     not declare, which is `dependency-direction`'s rule arriving through the back door.
 *
 * The manifest, the package.json and the tsconfig are three statements of one fact. Two of them
 * were already checked against each other; this is the third.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadManifest, REPO_ROOT } from './manifest.js';

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
}

interface TsConfig {
  readonly references?: readonly { readonly path: string }[];
}

/** JSON with comments and trailing commas — tsconfig's dialect, not JSON.parse's. */
function readTsConfig(file: string): TsConfig {
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(text) as TsConfig;
}

const workspaceDeps = (manifest: PackageManifest): string[] =>
  Object.entries(manifest.dependencies ?? {})
    .filter(([name, range]) => name.startsWith('@pandalog/') && range.startsWith('workspace:'))
    .map(([name]) => name.replace('@pandalog/', ''))
    .sort();

/** Only the packages — `apps/web` has no composite project and is `web-resolution.test.ts`'s job. */
const packages = loadManifest().layers.filter((entry) => entry.path.startsWith('packages/'));

describe('the packages exist to be checked', () => {
  it('found them', () => {
    expect(packages.length).toBeGreaterThan(5);
  });
});

describe.each(packages.map((entry) => [entry.package, entry] as const))('%s', (_name, entry) => {
  const root = path.join(REPO_ROOT, entry.path);
  const declared = workspaceDeps(
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageManifest,
  );
  const referenced = (readTsConfig(path.join(root, 'tsconfig.json')).references ?? [])
    .map((reference) => path.basename(reference.path))
    .sort();

  it('references every workspace dependency it declares', () => {
    // Missing here means `tsc -b` cannot see the package, which typecheck and test will not
    // notice — they resolve through node_modules to a dist that may already exist.
    expect(
      declared.filter((dependency) => !referenced.includes(dependency)),
      `${entry.package} depends on these but its tsconfig references none of them`,
    ).toEqual([]);
  });

  it('declares every workspace package it references', () => {
    expect(
      referenced.filter((reference) => !declared.includes(reference)),
      `${entry.package} references these but its package.json declares none of them`,
    ).toEqual([]);
  });

  it('declares nothing the dependency manifest does not allow', () => {
    const allowed = new Set(
      entry.allowedDependencies.map((dependency) => dependency.replace('@pandalog/', '')),
    );

    expect(
      declared.filter((dependency) => !allowed.has(dependency)),
      `${entry.package} declares a dependency dependency-layers.json does not permit`,
    ).toEqual([]);
  });
});

describe('the check can fail', () => {
  // Doc 05 requires an architecture check to be shown failing rather than asserted to work.
  it('catches a dependency with no matching reference', () => {
    const declared = ['schema', 'events'];
    const referenced = ['schema'];

    expect(declared.filter((entry) => !referenced.includes(entry))).toEqual(['events']);
  });

  it('catches a reference with no matching dependency', () => {
    const declared = ['schema'];
    const referenced = ['schema', 'query'];

    expect(referenced.filter((entry) => !declared.includes(entry))).toEqual(['query']);
  });
});
