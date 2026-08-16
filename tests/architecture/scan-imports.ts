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

function listTypeScriptFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    // A package declared in the manifest but not yet created is a roadmap state, not a failure.
    return [];
  }

  return entries
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'))
    .map((entry) => path.join(dir, entry));
}

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

  const files = listTypeScriptFiles(srcDir).map((absolute) => ({
    file: path.relative(repoRoot, absolute),
    specifiers: extractSpecifiers(readFileSync(absolute, 'utf8'), absolute),
  }));

  return { package: packageName, files };
}
