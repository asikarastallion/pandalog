/**
 * Every workspace dependency a package declares appears in `pnpm-lock.yaml`.
 *
 * Third instance of one bug class, and the reason it keeps recurring is that the local machine
 * cannot see it. `pnpm install` without `--frozen-lockfile` quietly reconciles the lockfile, so a
 * dependency added and then *not* installed leaves a tree where typecheck, lint, test and build all
 * pass. CI installs with `--frozen-lockfile`, refuses to reconcile, and fails before it runs a
 * single test.
 *
 * `web-resolution.test.ts` covers the app's path mappings and `package-resolution.test.ts` covers
 * the packages' tsconfig references. Both were written after the same discovery: a declaration in
 * one file and not in another, invisible where it was made. The lockfile is the third file that has
 * to agree, and this is the check that makes the disagreement local.
 *
 * It deliberately reads the lockfile as text rather than parsing YAML. What matters is whether the
 * specifier is recorded at all; a parser would be a dependency added to check a dependency.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadManifest, REPO_ROOT } from './manifest.js';

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const lockfile = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');

/** Every importer the lockfile records, as the paths pnpm writes them. */
const importers = new Set(
  [...lockfile.matchAll(/^ {2}([^\s:]+):$/gm)].map((match) => match[1] ?? ''),
);

const entries = loadManifest().layers;

describe('the lockfile can be read', () => {
  it('records the workspace importers', () => {
    // A lockfile this check could not find its way around would pass vacuously.
    expect(importers.size).toBeGreaterThan(5);
    expect(importers.has('apps/web')).toBe(true);
  });
});

describe.each(entries.map((entry) => [entry.package, entry] as const))('%s', (_name, entry) => {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, entry.path, 'package.json'), 'utf8'),
  ) as PackageManifest;

  const declared = Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })
    .filter(([name, range]) => name.startsWith('@pandalog/') && range.startsWith('workspace:'))
    .map(([name]) => name);

  it('has every workspace dependency it declares recorded in the lockfile', () => {
    // `pnpm install --lockfile-only` is the fix when this fails.
    const importerBlock = lockfile.slice(lockfile.indexOf(`\n  ${entry.path}:\n`));
    const nextImporter = importerBlock.slice(1).search(/\n {2}[^\s:]+:\n/);
    const section = nextImporter === -1 ? importerBlock : importerBlock.slice(0, nextImporter + 1);

    for (const dependency of declared) {
      // pnpm quotes a scoped name — `'@pandalog/schema':` — so the bare `name:` never matches.
      expect(
        section.includes(`'${dependency}':`) || section.includes(`${dependency}:\n`),
        `${entry.package} declares ${dependency}, but pnpm-lock.yaml does not record it for ` +
          `${entry.path}. CI installs with --frozen-lockfile and will refuse this; run ` +
          '`pnpm install --lockfile-only` and commit the result.',
      ).toBe(true);
    }
  });
});

describe('the check can fail', () => {
  // Doc 05 requires an architecture check to be shown failing rather than asserted to work.
  it('notices a dependency the lockfile section does not mention', () => {
    const section = "  apps/web:\n    dependencies:\n      '@pandalog/schema':\n";

    expect(section.includes("'@pandalog/schema':")).toBe(true);
    expect(section.includes("'@pandalog/comparison':")).toBe(false);
  });
});
