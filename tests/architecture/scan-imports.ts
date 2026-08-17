/**
 * Static import scanner.
 *
 * Uses the TypeScript compiler API rather than a regex so that every form the language allows is
 * seen: static imports, re-exports, `import type`, dynamic `import()`, and `import(...)` types. A
 * regex would miss at least one of those, and the one it missed would be the one someone used to
 * cross a package boundary.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

export interface ScannedFile {
  /** Repository-relative path, for readable failure messages. */
  readonly file: string;
  readonly specifiers: readonly string[];
}

export interface ScannedPackage {
  readonly package: string;
  readonly files: readonly ScannedFile[];
}

function listSourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    // A package declared in the manifest but not yet created is a roadmap state, not a failure.
    return [];
  }

  return entries
    .filter(
      (entry) => (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) || entry.endsWith('.vue'),
    )
    .map((entry) => path.join(dir, entry));
}

/**
 * The TypeScript inside a single-file component.
 *
 * Vue components are where doc 04 §1 rules 1 and 2 are most likely to be broken — a component
 * reaching for a parser or doing its own unit maths — so leaving `.vue` unscanned would exempt the
 * files the rules are aimed at. Each `<script>` block is concatenated and handed to the same
 * extractor the `.ts` files use, so every import form is still seen.
 */
export function extractScriptBlocks(sourceText: string): string {
  const blocks: string[] = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

  let match = pattern.exec(sourceText);
  while (match !== null) {
    blocks.push(match[1] ?? '');
    match = pattern.exec(sourceText);
  }

  return blocks.join('\n');
}

const readSource = (absolute: string): string => {
  const text = readFileSync(absolute, 'utf8');
  return absolute.endsWith('.vue') ? extractScriptBlocks(text) : text;
};

/** Every module specifier referenced by a source file. */
export function extractSpecifiers(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ESNext, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    // `const x = await import('...')`
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteral(first)) {
        specifiers.push(first.text);
      }
    }

    // `type X = import('...').Y`
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

/**
 * Only the specifiers a file imports *values* from.
 *
 * A type-only import is erased before the code runs: it carries no function, no constant and no
 * conversion factor, so it cannot make a component compute anything. Treating it the same as a
 * value import would force presentational components to redeclare shapes the canonical model
 * already defines — the parallel representation doc 04 forbids — in the name of a rule about
 * behaviour.
 *
 * Counts as a value import: a default or namespace binding, at least one named binding that is not
 * marked `type`, or a bare side-effect import.
 */
export function extractValueSpecifiers(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ESNext, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;

      // `import 'x'` runs the module for its side effects.
      const isSideEffectOnly = clause === undefined;
      const isTypeOnly = clause?.isTypeOnly === true;

      const bindings = clause?.namedBindings;
      const hasValueNamed =
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((element) => !element.isTypeOnly);
      const hasNamespace = bindings !== undefined && ts.isNamespaceImport(bindings);
      const hasDefault = clause?.name !== undefined;

      if (isSideEffectOnly || (!isTypeOnly && (hasValueNamed || hasNamespace || hasDefault))) {
        specifiers.push(node.moduleSpecifier.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

/**
 * Scan a package's `src` directory.
 *
 * Only `src` is scanned: test files legitimately import test helpers and Node builtins, and a
 * package's *shipped* dependencies are what the manifest governs.
 */
export function scanPackage(
  repoRoot: string,
  packageName: string,
  packagePath: string,
): ScannedPackage {
  const srcDir = path.join(repoRoot, packagePath, 'src');

  const files = listSourceFiles(srcDir).map((absolute) => ({
    file: path.relative(repoRoot, absolute),
    specifiers: extractSpecifiers(readSource(absolute), absolute),
  }));

  return { package: packageName, files };
}
