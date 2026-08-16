/**
 * Dependency-direction enforcement — 01_SYSTEM_ARCHITECTURE.md §6,
 * 05_IMPLEMENTATION_ROADMAP.md Phase A acceptance.
 *
 * Two halves, and both matter:
 *
 *  1. **The checker can fail.** Synthetic import graphs exercise every violation kind, so the
 *     green result in half 2 means "no violations found" rather than "the check does nothing".
 *     `tests/README.md` records the equivalent mutations against real source.
 *  2. **The repository is clean.** The same checker runs over the actual package sources.
 */
import { describe, expect, it } from 'vitest';

import {
  checkDependencies,
  checkManifestConsistency,
  type Violation,
  type ViolationKind,
} from './check-dependencies.js';
import { loadManifest, REPO_ROOT, type DependencyManifest } from './manifest.js';
import { extractSpecifiers, scanPackage, type ScannedPackage } from './scan-imports.js';

const manifest = loadManifest();

const kinds = (violations: readonly Violation[]): ViolationKind[] =>
  violations.map((violation) => violation.kind);

/** One synthetic package with one synthetic file. */
const scanned = (packageName: string, specifiers: string[]): ScannedPackage[] => [
  { package: packageName, files: [{ file: `${packageName}/src/index.ts`, specifiers }] },
];

describe('the dependency manifest', () => {
  it('declares every package the roadmap names, in a consistent order', () => {
    const problems = checkManifestConsistency(manifest);

    expect(problems).toEqual([]);
  });

  it('gives every entry a layer, a path, a phase and an explicit platformNeutral flag', () => {
    for (const entry of manifest.layers) {
      expect(Number.isInteger(entry.layer), `${entry.package} layer`).toBe(true);
      expect(entry.path, `${entry.package} path`).toMatch(/^(packages|apps)\//);
      expect(entry.introducedInPhase, `${entry.package} phase`).toMatch(/^[A-L]$/);
      expect(typeof entry.platformNeutral, `${entry.package} platformNeutral`).toBe('boolean');
      expect(entry.responsibility.length, `${entry.package} responsibility`).toBeGreaterThan(0);
    }
  });

  it('keeps schema at layer 0 with no dependencies, so anything can adopt the model', () => {
    const schema = manifest.layers.find((entry) => entry.package === '@pandalog/schema');

    expect(schema?.layer).toBe(0);
    expect(schema?.allowedDependencies).toEqual([]);
    expect(schema?.platformNeutral).toBe(true);
  });

  it('lets nothing depend on the AI package, so it can be deleted (doc 01 §4)', () => {
    for (const entry of manifest.layers) {
      expect(entry.allowedDependencies, `${entry.package}`).not.toContain('@pandalog/ai');
    }
  });

  it('lets nothing depend on an application package', () => {
    for (const entry of manifest.layers) {
      expect(entry.allowedDependencies, `${entry.package}`).not.toContain('@pandalog/cli');
      expect(entry.allowedDependencies, `${entry.package}`).not.toContain('@pandalog/web');
    }
  });
});

describe('the checker detects each violation it exists to detect', () => {
  it('catches an upward dependency', () => {
    // schema (layer 0) reaching up to core-domain (layer 1).
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/schema', ['@pandalog/core-domain']),
    );

    // Undeclared fires first because schema declares no dependencies at all; both are violations
    // of the same import, and either one failing the build is the point.
    expect(kinds(violations)).toContain('UNDECLARED_DEPENDENCY');
    expect(violations).toHaveLength(1);
  });

  it('catches an upward dependency that is otherwise declared', () => {
    // A manifest where the dependency is allowed but points the wrong way isolates the layer rule.
    const bent: DependencyManifest = {
      ...manifest,
      layers: manifest.layers.map((entry) =>
        entry.package === '@pandalog/schema'
          ? { ...entry, allowedDependencies: ['@pandalog/core-domain'] }
          : entry,
      ),
    };

    const violations = checkDependencies(
      bent,
      scanned('@pandalog/schema', ['@pandalog/core-domain']),
    );

    expect(kinds(violations)).toEqual(['UPWARD_DEPENDENCY']);
  });

  it('catches an undeclared import', () => {
    // query (layer 4) may use schema and core-domain, but not ingestion.
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/query', ['@pandalog/ingestion']),
    );

    expect(kinds(violations)).toEqual(['UNDECLARED_DEPENDENCY']);
  });

  it('catches a node: import in a platformNeutral package', () => {
    const violations = checkDependencies(manifest, scanned('@pandalog/core-domain', ['node:fs']));

    expect(kinds(violations)).toEqual(['NODE_IMPORT_IN_PLATFORM_NEUTRAL']);
  });

  it('catches a bare Node builtin import, not just the node: form', () => {
    const violations = checkDependencies(manifest, scanned('@pandalog/analysis', ['fs']));

    expect(kinds(violations)).toEqual(['NODE_IMPORT_IN_PLATFORM_NEUTRAL']);
  });

  it('allows Node builtins in packages that are not platformNeutral', () => {
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/parser-ardupilot', ['node:fs']),
    );

    expect(violations).toEqual([]);
  });

  it('catches a package importing an application', () => {
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/analysis', ['@pandalog/web']),
    );

    expect(kinds(violations)).toEqual(['APPLICATION_IMPORTED']);
  });

  it('catches a deep import that reaches past a package entry point', () => {
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/core-domain', ['@pandalog/schema/src/validation.js']),
    );

    expect(kinds(violations)).toEqual(['DEEP_IMPORT']);
  });

  it('catches an import of a package that is not in the manifest at all', () => {
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/analysis', ['@pandalog/telemetry']),
    );

    expect(kinds(violations)).toEqual(['UNKNOWN_PACKAGE']);
  });

  it('accepts a declared, downward dependency', () => {
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/ingestion', ['@pandalog/schema']),
    );

    expect(violations).toEqual([]);
  });

  it('ignores third-party and relative specifiers', () => {
    const violations = checkDependencies(
      manifest,
      scanned('@pandalog/core-domain', ['./signal.js', '../errors.js', 'vitest']),
    );

    expect(violations).toEqual([]);
  });

  it('reports the file and specifier so a failure is actionable', () => {
    const [violation] = checkDependencies(
      manifest,
      scanned('@pandalog/query', ['@pandalog/ingestion']),
    );

    expect(violation?.file).toBe('@pandalog/query/src/index.ts');
    expect(violation?.specifier).toBe('@pandalog/ingestion');
    expect(violation?.message).toContain('allowedDependencies');
  });
});

describe('the import scanner sees every form of import', () => {
  it.each([
    ['static import', `import { a } from '@pandalog/schema';`],
    ['type-only import', `import type { A } from '@pandalog/schema';`],
    ['namespace import', `import * as s from '@pandalog/schema';`],
    ['side-effect import', `import '@pandalog/schema';`],
    ['re-export', `export { a } from '@pandalog/schema';`],
    ['star re-export', `export * from '@pandalog/schema';`],
    ['dynamic import', `const m = await import('@pandalog/schema');`],
    ['import type node', `type A = import('@pandalog/schema').Signal;`],
  ])('sees a %s', (_label, source) => {
    expect(extractSpecifiers(source, 'probe.ts')).toContain('@pandalog/schema');
  });

  it('does not mistake a string that merely mentions a package for an import', () => {
    const source = `const note = 'see @pandalog/schema for details';`;

    expect(extractSpecifiers(source, 'probe.ts')).toEqual([]);
  });
});

describe('the repository itself obeys the manifest', () => {
  const scannedPackages = manifest.layers.map((entry) =>
    scanPackage(REPO_ROOT, entry.package, entry.path),
  );

  it('has no dependency-direction violations', () => {
    const violations = checkDependencies(manifest, scannedPackages);

    expect(violations.map((violation) => `${violation.kind}: ${violation.message}`)).toEqual([]);
  });

  it('actually scanned the packages that exist, so a green result means something', () => {
    const withSource = scannedPackages.filter((entry) => entry.files.length > 0);

    // The packages built so far. This guards the failure mode where a path typo makes every
    // package scan zero files and the check passes vacuously.
    expect(withSource.map((entry) => entry.package).sort()).toEqual([
      '@pandalog/analysis',
      '@pandalog/core-domain',
      '@pandalog/events',
      '@pandalog/ingestion',
      '@pandalog/parser-ardupilot',
      '@pandalog/query',
      '@pandalog/schema',
    ]);
  });
});
