/**
 * Every workspace package `apps/web` depends on resolves from source.
 *
 * This exists because the same defect landed twice, and both times CI caught what no local run
 * could. `apps/web` maps workspace packages to their `src/index.ts` in both `tsconfig.json` and
 * `vite.config.ts`. A dependency added to `package.json` without those mappings still *works*
 * locally — it resolves through `node_modules` to `dist/*.d.ts`, which exists on any machine that
 * has ever run a build. On a clean checkout there is no `dist`, and `pnpm verify` typechecks before
 * it builds, so the failure appears only in CI.
 *
 * That is a bug class, not a bug: invisible where it is introduced, reproducible only somewhere
 * else. So it is checked here rather than remembered.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './manifest.js';

const WEB = path.join(REPO_ROOT, 'apps', 'web');

const read = (file: string): string => readFileSync(path.join(WEB, file), 'utf8');

const workspaceDepsOf = (manifestJson: string): string[] => {
  const manifest = JSON.parse(manifestJson) as { dependencies?: Record<string, string> };
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name, range]) => name.startsWith('@pandalog/') && range.startsWith('workspace:'))
    .map(([name]) => name);
};

/**
 * Every workspace package the app pulls in, **transitively**.
 *
 * The transitive closure, not the declared list: `apps/web` imports `@pandalog/reporting`, which
 * imports `@pandalog/comparison`, and TypeScript has to resolve that second hop too. Checking only
 * direct dependencies is what let the second instance of this bug through — the mapping for the
 * package the app names was added, and the one it reaches through that package was not.
 */
function reachableWorkspacePackages(): string[] {
  const seen = new Set<string>();
  const queue = workspaceDepsOf(read('package.json'));

  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);

    const short = name.replace('@pandalog/', '');
    try {
      queue.push(
        ...workspaceDepsOf(
          readFileSync(path.join(REPO_ROOT, 'packages', short, 'package.json'), 'utf8'),
        ),
      );
    } catch {
      // A package with no manifest is a different failure, and `dependency-direction` owns it.
    }
  }

  return [...seen].sort();
}

const dependencies = reachableWorkspacePackages();

describe('apps/web resolves every workspace package it depends on', () => {
  it('declares some, so this test is not vacuous', () => {
    expect(dependencies.length).toBeGreaterThan(3);
  });

  it.each(dependencies)('%s has a tsconfig path mapping', (name) => {
    // Without this, `vue-tsc` falls back to node_modules → dist/*.d.ts, which only exists after a
    // build — so typecheck passes on a machine that has built and fails on a clean checkout.
    expect(read('tsconfig.json')).toContain(`"${name}":`);
  });

  it.each(dependencies)('%s has a vite alias', (name) => {
    // Without this the bundle is built from whatever `dist/` happens to be lying around, rather
    // than from the source the tests just ran against.
    expect(read('vite.config.ts')).toContain(`'${name}':`);
  });

  it('maps each package to its source entry, not to a built artifact', () => {
    const tsconfig = read('tsconfig.json');

    for (const name of dependencies) {
      const short = name.replace('@pandalog/', '');
      expect(tsconfig, name).toContain(`packages/${short}/src/index.ts`);
    }
  });
});
