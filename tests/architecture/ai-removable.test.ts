/**
 * Phase L acceptance — 05_IMPLEMENTATION_ROADMAP.md:
 *
 * > Deleting `packages/ai` leaves `packages/cli` and `apps/web`'s core
 * > investigation/verification/reporting flows building and passing tests unchanged.
 *
 * Doc 01 §4 puts it as the mechanical form of "if the AI layer is removed, the main product must
 * still function". `dependency-direction.test.ts` already checks the *manifest* lists `@pandalog/ai`
 * as nobody's dependency; this checks the repository, which is a different claim — a manifest can be
 * correct while a source file imports the package anyway, and it is the import that breaks a build.
 *
 * Three couplings would each survive a clean manifest, and all three are checked: a source import,
 * a `package.json` dependency, and a `tsconfig.json` project reference. With none of them present,
 * removing the directory cannot break another package's build. What it *does* require is deleting
 * the package's own entries from the workspace and the root build list — true of any package, and
 * not what the criterion is about.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadManifest, REPO_ROOT } from './manifest.js';
import { scanPackage } from './scan-imports.js';

const AI_PACKAGE = '@pandalog/ai';
const AI_PATH = 'packages/ai';

const manifest = loadManifest();
const others = manifest.layers.filter((entry) => entry.package !== AI_PACKAGE);

const readJson = (file: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

describe('packages/ai is removable', () => {
  it('exists, so this test is checking something', () => {
    // Without this, every assertion below would pass vacuously the day the package went missing
    // for the wrong reason.
    expect(manifest.layers.some((entry) => entry.package === AI_PACKAGE)).toBe(true);
    expect(readdirSync(path.join(REPO_ROOT, AI_PATH, 'src')).length).toBeGreaterThan(0);
  });

  it('is imported by no other package', () => {
    const offenders = others.flatMap((entry) =>
      scanPackage(REPO_ROOT, entry.package, entry.path)
        .files.filter((file) =>
          file.specifiers.some(
            (specifier) => specifier === AI_PACKAGE || specifier.startsWith(`${AI_PACKAGE}/`),
          ),
        )
        .map((file) => file.file),
    );

    expect(offenders).toEqual([]);
  });

  it('is listed as a dependency by no other package', () => {
    const offenders = others.filter((entry) => {
      const manifestJson = readJson(path.join(entry.path, 'package.json'));
      const dependencies = {
        ...((manifestJson.dependencies as Record<string, string> | undefined) ?? {}),
        ...((manifestJson.devDependencies as Record<string, string> | undefined) ?? {}),
      };
      return AI_PACKAGE in dependencies;
    });

    expect(offenders.map((entry) => entry.package)).toEqual([]);
  });

  it('is referenced by no other package tsconfig', () => {
    const offenders = others.filter((entry) => {
      const tsconfig = readJson(path.join(entry.path, 'tsconfig.json'));
      const references = (tsconfig.references as { path?: string }[] | undefined) ?? [];
      return references.some((reference) => (reference.path ?? '').endsWith('/ai'));
    });

    expect(offenders.map((entry) => entry.package)).toEqual([]);
  });

  it('the applications the criterion names are specifically clean', () => {
    // Named explicitly rather than relying on the sweep above, because these two are what the
    // acceptance criterion is actually about and a change to the manifest must not quietly stop
    // covering them.
    for (const application of ['@pandalog/cli', '@pandalog/web']) {
      const entry = manifest.layers.find((layer) => layer.package === application);
      expect(entry, `${application} missing from the manifest`).toBeDefined();

      const specifiers = scanPackage(REPO_ROOT, application, entry?.path ?? '').files.flatMap(
        (file) => file.specifiers,
      );

      expect(specifiers, application).not.toContain(AI_PACKAGE);
      expect(entry?.allowedDependencies, application).not.toContain(AI_PACKAGE);
    }
  });

  it('depends only on the read side of the evidence chain (doc 01 §4)', () => {
    const entry = manifest.layers.find((layer) => layer.package === AI_PACKAGE);

    // No ingestion, no parser, no query, no events: the AI sees conclusions, never the raw data
    // they were drawn from (doc 03 §7).
    expect([...(entry?.allowedDependencies ?? [])].sort()).toEqual([
      '@pandalog/analysis',
      '@pandalog/comparison',
      '@pandalog/schema',
      '@pandalog/verification',
    ]);
  });
});
