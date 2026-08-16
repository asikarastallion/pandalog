/**
 * Adapter registry — 01_SYSTEM_ARCHITECTURE.md §4.
 *
 * Immutable by construction: `withAdapter` returns a new registry rather than mutating one, so a
 * registry handed to a caller cannot change underneath it. Registration happens once, at
 * composition time, in the CLI or the web app.
 */
import { IngestionError } from './errors.js';
import type { ParserAdapter, SourceFile } from './adapter.js';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ParserAdapterRegistry {
  readonly adapters: readonly ParserAdapter[];

  /**
   * The first adapter, in registration order, whose `canParse` accepts the file; null if none do.
   *
   * First-match rather than "error on ambiguity" because reproducibility is the priority: the same
   * inputs must always select the same adapter, and registration order is something the composing
   * application controls explicitly.
   */
  select(file: SourceFile): ParserAdapter | null;

  /** A new registry containing this adapter as well. The receiver is unchanged. */
  withAdapter(adapter: ParserAdapter): ParserAdapterRegistry;
}

function assertMetadata(adapter: ParserAdapter): void {
  const { packageName, version, format } = adapter.metadata;

  if (format.length === 0) {
    throw new IngestionError(
      'ADAPTER_METADATA_INVALID',
      'A parser adapter must declare a non-empty source format identifier.',
      { context: { packageName } },
    );
  }
  if (packageName.length === 0) {
    throw new IngestionError(
      'ADAPTER_METADATA_INVALID',
      `Adapter for format ${format} must declare its package name; it is recorded in provenance.`,
      { context: { format } },
    );
  }
  if (!SEMVER_RE.test(version)) {
    throw new IngestionError(
      'ADAPTER_METADATA_INVALID',
      `Adapter ${packageName} declares version ${JSON.stringify(version)}, which is not semver. ` +
        'Provenance records this version so an analysis can be reproduced against the exact parser.',
      { context: { packageName, format, version } },
    );
  }
}

function build(adapters: readonly ParserAdapter[]): ParserAdapterRegistry {
  const frozen = Object.freeze([...adapters]);

  return Object.freeze({
    adapters: frozen,

    select(file: SourceFile): ParserAdapter | null {
      return frozen.find((adapter) => adapter.canParse(file)) ?? null;
    },

    withAdapter(adapter: ParserAdapter): ParserAdapterRegistry {
      assertMetadata(adapter);

      const clash = frozen.find((existing) => existing.metadata.format === adapter.metadata.format);
      if (clash !== undefined) {
        throw new IngestionError(
          'DUPLICATE_ADAPTER',
          `Two adapters declare the source format ${JSON.stringify(adapter.metadata.format)}: ` +
            `${clash.metadata.packageName} and ${adapter.metadata.packageName}. ` +
            'Selection would depend on registration order, making ingestion unreproducible.',
          { context: { format: adapter.metadata.format } },
        );
      }

      return build([...frozen, adapter]);
    },
  });
}

/**
 * Build a registry from zero or more adapters.
 *
 * @throws {IngestionError} on malformed adapter metadata or two adapters claiming one format.
 */
export function createAdapterRegistry(
  adapters: Iterable<ParserAdapter> = [],
): ParserAdapterRegistry {
  let registry = build([]);
  for (const adapter of adapters) {
    registry = registry.withAdapter(adapter);
  }
  return registry;
}
