/**
 * The dependency-direction rules, as a pure function.
 *
 * Kept pure and separate from the filesystem so the checker itself can be tested with synthetic
 * import graphs. That matters: a check that has never been observed to fail is not evidence of
 * anything. `dependency-direction.test.ts` feeds it deliberate violations and asserts each one is
 * caught, then runs it over the real source tree.
 */
import { APPLICATION_PACKAGES, type DependencyManifest } from './manifest.js';
import type { ScannedPackage } from './scan-imports.js';

export type ViolationKind =
  /** Imports a `@pandalog/*` package that has no manifest entry. */
  | 'UNKNOWN_PACKAGE'
  /** Imports a package absent from this package's `allowedDependencies`. */
  | 'UNDECLARED_DEPENDENCY'
  /** Imports a package at the same or a higher layer. */
  | 'UPWARD_DEPENDENCY'
  /** Reaches past a package's public entry point into its internals (doc 04 §2). */
  | 'DEEP_IMPORT'
  /** A `platformNeutral: true` package imports a Node builtin. */
  | 'NODE_IMPORT_IN_PLATFORM_NEUTRAL'
  /** Any package importing an application package (doc 01 §3 rule 2). */
  | 'APPLICATION_IMPORTED';

export interface Violation {
  readonly kind: ViolationKind;
  readonly package: string;
  readonly file: string;
  readonly specifier: string;
  readonly message: string;
}

/**
 * Node builtins reachable without the `node:` prefix. The prefix form is caught separately; this
 * list closes the bare-specifier loophole, which is the one a copy-paste from older code uses.
 */
const BARE_NODE_BUILTINS: ReadonlySet<string> = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) {
    return true;
  }
  const [root] = specifier.split('/');
  return root !== undefined && BARE_NODE_BUILTINS.has(root);
}

/** `@pandalog/schema/internal/thing` -> `@pandalog/schema`; returns null for anything else. */
function internalPackageOf(specifier: string): string | null {
  if (!specifier.startsWith('@pandalog/')) {
    return null;
  }
  const [scope, name] = specifier.split('/');
  return scope !== undefined && name !== undefined ? `${scope}/${name}` : null;
}

export function checkDependencies(
  manifest: DependencyManifest,
  scanned: readonly ScannedPackage[],
): Violation[] {
  const byName = new Map(manifest.layers.map((entry) => [entry.package, entry]));
  const violations: Violation[] = [];

  for (const scannedPackage of scanned) {
    const self = byName.get(scannedPackage.package);
    if (self === undefined) {
      continue;
    }
    const allowed = new Set(self.allowedDependencies);

    for (const { file, specifiers } of scannedPackage.files) {
      for (const specifier of specifiers) {
        const add = (kind: ViolationKind, message: string): void => {
          violations.push({ kind, package: scannedPackage.package, file, specifier, message });
        };

        if (self.platformNeutral && isNodeBuiltin(specifier)) {
          add(
            'NODE_IMPORT_IN_PLATFORM_NEUTRAL',
            `${scannedPackage.package} is platformNeutral, so it must run unmodified in a browser ` +
              `Worker, but ${file} imports the Node builtin "${specifier}".`,
          );
          continue;
        }

        const target = internalPackageOf(specifier);
        if (target === null || target === scannedPackage.package) {
          continue;
        }

        if (APPLICATION_PACKAGES.includes(target)) {
          add(
            'APPLICATION_IMPORTED',
            `${file} imports the application package ${target}. Applications depend on packages; ` +
              'packages never depend on an application.',
          );
          continue;
        }

        const targetEntry = byName.get(target);
        if (targetEntry === undefined) {
          add(
            'UNKNOWN_PACKAGE',
            `${file} imports ${target}, which has no entry in dependency-layers.json. A new ` +
              'package needs a manifest entry, a layer, and a roadmap phase before code uses it.',
          );
          continue;
        }

        if (specifier !== target) {
          add(
            'DEEP_IMPORT',
            `${file} imports ${specifier}, reaching past ${target}'s public entry point. A ` +
              "package's API is what its index.ts exports (doc 04 §2).",
          );
          continue;
        }

        if (!allowed.has(target)) {
          add(
            'UNDECLARED_DEPENDENCY',
            `${file} imports ${target}, which is not in ${scannedPackage.package}'s ` +
              'allowedDependencies. Add it to the manifest deliberately, or remove the import.',
          );
          continue;
        }

        if (targetEntry.layer >= self.layer) {
          add(
            'UPWARD_DEPENDENCY',
            `${file} imports ${target} (layer ${String(targetEntry.layer)}) from ` +
              `${scannedPackage.package} (layer ${String(self.layer)}). Dependencies may only ` +
              'point toward lower layer numbers.',
          );
        }
      }
    }
  }

  return violations;
}

/**
 * Self-consistency of the manifest itself, independent of any source code: every declared
 * dependency must exist and must sit strictly lower in the layer order.
 */
export function checkManifestConsistency(manifest: DependencyManifest): string[] {
  const byName = new Map(manifest.layers.map((entry) => [entry.package, entry]));
  const problems: string[] = [];

  for (const entry of manifest.layers) {
    for (const dependency of entry.allowedDependencies) {
      const target = byName.get(dependency);
      if (target === undefined) {
        problems.push(
          `${entry.package} allows ${dependency}, which is not declared in the manifest.`,
        );
        continue;
      }
      if (target.layer >= entry.layer) {
        problems.push(
          `${entry.package} (layer ${String(entry.layer)}) allows ${dependency} (layer ` +
            `${String(target.layer)}); allowed dependencies must point strictly downward.`,
        );
      }
    }
  }

  const names = manifest.layers.map((entry) => entry.package);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  for (const duplicate of new Set(duplicates)) {
    problems.push(`${duplicate} appears more than once in the manifest.`);
  }

  return problems;
}
