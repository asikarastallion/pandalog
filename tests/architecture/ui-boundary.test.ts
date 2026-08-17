/**
 * The UI boundary — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §1 rules 1, 2 and 7, and doc 05 Phase H:
 *
 * > No component imports a `parser-*` internal or performs unit/time math directly.
 *
 * `dependency-direction.test.ts` already holds `apps/web` to the manifest, and now scans `.vue`
 * script blocks too. That covers rule 2 — a component cannot reach a parser at all. This file adds
 * the part a dependency graph cannot express: a component may not *compute*.
 *
 * The check is deliberately structural rather than a judgement about what counts as "logic". A
 * component may import Vue, its sibling components, the workspace modules, and types. If it needs a
 * number worked out, the working-out belongs in `src/workspace/` where it can be tested without a
 * browser — which is what makes doc 04 §1 rule 3 hold for the app as well as the packages.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './manifest.js';
import { extractScriptBlocks, extractSpecifiers, extractValueSpecifiers } from './scan-imports.js';

const COMPONENTS_DIR = path.join(REPO_ROOT, 'apps', 'web', 'src', 'components');

interface Component {
  readonly name: string;
  readonly file: string;
  readonly source: string;
  readonly script: string;
  readonly specifiers: readonly string[];
  /** Specifiers imported for a value, which is what can make a component compute. */
  readonly valueSpecifiers: readonly string[];
}

function loadComponents(): Component[] {
  let entries: string[];
  try {
    entries = readdirSync(COMPONENTS_DIR, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.endsWith('.vue'))
    .map((entry) => {
      const absolute = path.join(COMPONENTS_DIR, entry);
      const source = readFileSync(absolute, 'utf8');
      const script = extractScriptBlocks(source);
      return {
        name: entry,
        file: path.relative(REPO_ROOT, absolute),
        source,
        script,
        specifiers: extractSpecifiers(script, absolute),
        valueSpecifiers: extractValueSpecifiers(script, absolute),
      };
    });
}

const components = loadComponents();

/**
 * Packages a component may not import a *value* from.
 *
 * `core-domain` is the unit and time-base authority: a component calling into it is a component
 * about to convert something. The conversion belongs in `workspace/format.ts` or
 * `workspace/plot.ts`, which call `core-domain` and are tested for it.
 *
 * Types from these packages are fine. A type is erased before anything runs, so it cannot convert
 * a value — and forbidding them would push components into redeclaring shapes the canonical model
 * already owns, which is the parallel representation doc 04 exists to prevent.
 */
const FORBIDDEN_PACKAGES = ['@pandalog/core-domain', '@pandalog/ingestion', '@pandalog/pipeline'];

const FORBIDDEN_PREFIXES = ['@pandalog/parser-'];

describe('the components exist to be checked', () => {
  it('found the Vue components', () => {
    expect(components.length).toBeGreaterThan(0);
  });

  it('read a script block out of each one, so the scan is not vacuous', () => {
    for (const component of components) {
      expect(component.script.length, `${component.file} yielded no script`).toBeGreaterThan(0);
    }
  });
});

describe('a component never reaches a parser (doc 04 §1 rule 2)', () => {
  it.each(components.map((component) => [component.name, component] as const))(
    '%s',
    (_name, component) => {
      for (const specifier of component.specifiers) {
        for (const prefix of FORBIDDEN_PREFIXES) {
          expect(
            specifier.startsWith(prefix),
            `${component.file} imports ${specifier}. Decoding a log format is adapter territory; ` +
              'a component consumes the canonical model.',
          ).toBe(false);
        }
      }
    },
  );
});

describe('a component never does unit or time maths (doc 04 §1 rules 1 and 7)', () => {
  it.each(components.map((component) => [component.name, component] as const))(
    '%s imports no conversion authority',
    (_name, component) => {
      for (const specifier of component.valueSpecifiers) {
        expect(
          FORBIDDEN_PACKAGES.includes(specifier),
          `${component.file} imports ${specifier}. If it needs a converted value, ask ` +
            'workspace/format.ts for one — that module calls core-domain and is tested for it.',
        ).toBe(false);
      }
    },
  );

  it.each(components.map((component) => [component.name, component] as const))(
    '%s contains no conversion constant',
    (_name, component) => {
      // The factors a hand-rolled conversion needs. Finding one in a component means the component
      // is doing arithmetic the unit table exists to own.
      const suspects = [
        /Math\.PI\s*\/\s*180/,
        /180\s*\/\s*Math\.PI/,
        /\b57\.29\d*/,
        /\b0\.0174\d*/,
        /\b273\.15\b/,
        /\b9\.80665\b/,
        /\b1e-?7\b/,
      ];

      for (const suspect of suspects) {
        expect(
          suspect.test(component.script),
          `${component.file} contains ${String(suspect)}, which is a unit conversion. Conversions ` +
            'live in @pandalog/core-domain (doc 04 §1 rule 7).',
        ).toBe(false);
      }
    },
  );
});

describe('the check can fail', () => {
  // Doc 05 requires the architecture checks to be shown failing rather than asserted to work. These
  // run the same predicates over a fabricated component, so the guard is proven without committing
  // a violation to the tree.
  const fabricated = `
    <script setup lang="ts">
    import { decodeDataflash } from '@pandalog/parser-ardupilot/src/dataflash.js';
    import { toCanonical } from '@pandalog/core-domain';
    const degrees = radians * (180 / Math.PI);
    </script>
  `;
  const script = extractScriptBlocks(fabricated);
  const specifiers = extractSpecifiers(script, 'Fabricated.vue');
  const valueSpecifiers = extractValueSpecifiers(script, 'Fabricated.vue');

  it('catches a component importing a parser internal', () => {
    expect(specifiers.some((s) => s.startsWith('@pandalog/parser-'))).toBe(true);
  });

  it('catches a component importing the conversion authority', () => {
    expect(valueSpecifiers.some((s) => FORBIDDEN_PACKAGES.includes(s))).toBe(true);
  });

  it('does not mistake a type-only import for a value import', () => {
    const typeOnly = extractValueSpecifiers(
      "import type { PipelineResult } from '@pandalog/pipeline';",
      'TypeOnly.vue',
    );

    expect(typeOnly).toEqual([]);
  });

  it('catches an inline radian conversion', () => {
    expect(/180\s*\/\s*Math\.PI/.test(script)).toBe(true);
  });
});
