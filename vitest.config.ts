import path from 'node:path';

import { defineConfig } from 'vitest/config';

/** Resolve a workspace package to its source entry point so tests run without a build step. */
const pkgSrc = (name: string): string =>
  path.resolve(import.meta.dirname, 'packages', name, 'src', 'index.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@pandalog/schema': pkgSrc('schema'),
      '@pandalog/core-domain': pkgSrc('core-domain'),
      '@pandalog/ingestion': pkgSrc('ingestion'),
      '@pandalog/parser-ardupilot': pkgSrc('parser-ardupilot'),
      '@pandalog/query': pkgSrc('query'),
      '@pandalog/events': pkgSrc('events'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
      // index.ts files are re-export barrels with no branches of their own.
      exclude: ['packages/*/src/index.ts'],
      // doc 04 §5: 80% threshold enforced repo-wide.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
