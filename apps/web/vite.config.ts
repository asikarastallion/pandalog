import path from 'node:path';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Resolve a workspace package to its source entry, so the app builds without a package build. */
const pkgSrc = (name: string): string => path.join(repoRoot, 'packages', name, 'src', 'index.ts');

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@pandalog/schema': pkgSrc('schema'),
      '@pandalog/core-domain': pkgSrc('core-domain'),
      // Reached through @pandalog/pipeline rather than imported here, but still resolved from
      // source: otherwise the bundle would silently be built from whatever dist/ happened to exist.
      '@pandalog/ingestion': pkgSrc('ingestion'),
      '@pandalog/parser-ardupilot': pkgSrc('parser-ardupilot'),
      '@pandalog/query': pkgSrc('query'),
      '@pandalog/events': pkgSrc('events'),
      '@pandalog/analysis': pkgSrc('analysis'),
      '@pandalog/verification': pkgSrc('verification'),
      '@pandalog/pipeline': pkgSrc('pipeline'),
    },
  },

  // Relative asset URLs, so the built app runs from a static host, a subdirectory, or file://
  // without a server rewriting anything (doc 01 §2, ADR-0006).
  base: './',

  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
