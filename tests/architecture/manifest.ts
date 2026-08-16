/**
 * Loads `docs/architecture/dependency-layers.json`, the authoritative package graph
 * (01_SYSTEM_ARCHITECTURE.md §3).
 *
 * The manifest is data, not documentation: the architecture tests read it and fail the build when
 * the code disagrees with it. A structural change must update the manifest, doc 01, and the code in
 * the same commit — otherwise a real import has no manifest entry and the check fails.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'architecture', 'dependency-layers.json');

export interface LayerEntry {
  readonly layer: number;
  readonly package: string;
  readonly path: string;
  readonly responsibility: string;
  readonly allowedDependencies: readonly string[];
  readonly platformNeutral: boolean;
  readonly introducedInPhase: string;
}

export interface DependencyManifest {
  readonly description?: string;
  readonly layers: readonly LayerEntry[];
  readonly rules: readonly string[];
}

export function loadManifest(): DependencyManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as DependencyManifest;
}

/** Packages that are applications: nothing in the repository may depend on them (doc 01 §3 rule 2). */
export const APPLICATION_PACKAGES: readonly string[] = ['@pandalog/cli', '@pandalog/web'];
