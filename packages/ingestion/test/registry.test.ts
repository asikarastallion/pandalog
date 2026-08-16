/**
 * Adapter registry — 01_SYSTEM_ARCHITECTURE.md §4, 05_IMPLEMENTATION_ROADMAP.md Phase A.
 *
 * The registry is what makes "a new source format is a new adapter, never a rewrite" concrete.
 * It is immutable: `withAdapter` returns a new registry rather than mutating one, so a registry
 * handed to a caller cannot change underneath it.
 */
import { describe, expect, it } from 'vitest';

import {
  createAdapterRegistry,
  IngestionError,
  type ParsedFlightData,
  type ParserAdapter,
  type SourceFile,
} from '@pandalog/ingestion';

const emptyParse = (): ParsedFlightData => ({
  vehicle: { frameClass: null, firmwareVersion: null, firmwareHash: null },
  timeBase: {
    origin: 'BOOT',
    epochUtc: null,
    syncUncertaintySeconds: null,
    uniformlySampled: false,
  },
  signals: [],
});

function stubAdapter(format: string, canParse: (file: SourceFile) => boolean): ParserAdapter {
  return {
    metadata: { packageName: `@pandalog/parser-${format}`, version: '1.0.0', format },
    canParse,
    parse: emptyParse,
  };
}

const anyFile: SourceFile = { fileName: 'log.bin', bytes: Uint8Array.from([1, 2, 3]) };

describe('createAdapterRegistry', () => {
  it('starts empty', () => {
    expect(createAdapterRegistry().adapters).toEqual([]);
  });

  it('selects nothing when no adapter is registered', () => {
    expect(createAdapterRegistry().select(anyFile)).toBeNull();
  });

  it('selects the adapter that claims the file', () => {
    const registry = createAdapterRegistry([
      stubAdapter('tlog', () => false),
      stubAdapter('dataflash', () => true),
    ]);

    expect(registry.select(anyFile)?.metadata.format).toBe('dataflash');
  });

  it('selects nothing when no adapter claims the file', () => {
    const registry = createAdapterRegistry([stubAdapter('tlog', () => false)]);

    expect(registry.select(anyFile)).toBeNull();
  });

  it('resolves ambiguity deterministically by registration order', () => {
    const registry = createAdapterRegistry([
      stubAdapter('first', () => true),
      stubAdapter('second', () => true),
    ]);

    expect(registry.select(anyFile)?.metadata.format).toBe('first');
    // Reproducibility outranks cleverness here: the same inputs must always pick the same adapter.
    expect(registry.select(anyFile)?.metadata.format).toBe('first');
  });

  it('passes the file to canParse so selection can inspect magic bytes', () => {
    const seen: SourceFile[] = [];
    const registry = createAdapterRegistry([
      stubAdapter('dataflash', (file) => {
        seen.push(file);
        return file.bytes[0] === 1;
      }),
    ]);

    expect(registry.select(anyFile)).not.toBeNull();
    expect(seen).toEqual([anyFile]);
  });

  describe('immutability', () => {
    it('withAdapter returns a new registry and leaves the original alone', () => {
      const original = createAdapterRegistry();
      const extended = original.withAdapter(stubAdapter('dataflash', () => true));

      expect(original.adapters).toHaveLength(0);
      expect(extended.adapters).toHaveLength(1);
      expect(extended).not.toBe(original);
    });

    it('freezes the adapter list', () => {
      expect(Object.isFrozen(createAdapterRegistry().adapters)).toBe(true);
    });

    it('does not alias the caller-supplied adapter list', () => {
      const adapters = [stubAdapter('dataflash', () => true)];
      const registry = createAdapterRegistry(adapters);

      adapters.length = 0;

      expect(registry.adapters).toHaveLength(1);
    });
  });

  describe('rejects malformed registration', () => {
    it('rejects two adapters declaring the same format', () => {
      expect(() =>
        createAdapterRegistry([
          stubAdapter('dataflash', () => true),
          stubAdapter('dataflash', () => true),
        ]),
      ).toThrow(IngestionError);
    });

    it('rejects a duplicate format added through withAdapter', () => {
      const registry = createAdapterRegistry([stubAdapter('dataflash', () => true)]);

      expect(() => registry.withAdapter(stubAdapter('dataflash', () => true))).toThrow(
        IngestionError,
      );
    });

    it('reports DUPLICATE_ADAPTER for a format collision', () => {
      try {
        createAdapterRegistry([
          stubAdapter('dataflash', () => true),
          stubAdapter('dataflash', () => true),
        ]);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as IngestionError).code).toBe('DUPLICATE_ADAPTER');
      }
    });

    it('rejects an adapter whose metadata version is not semver', () => {
      const adapter: ParserAdapter = {
        metadata: { packageName: '@pandalog/parser-x', version: 'latest', format: 'x' },
        canParse: () => true,
        parse: emptyParse,
      };

      expect(() => createAdapterRegistry([adapter])).toThrow(IngestionError);
    });

    it('rejects an adapter with an empty format', () => {
      expect(() => createAdapterRegistry([stubAdapter('', () => true)])).toThrow(IngestionError);
    });
  });
});
