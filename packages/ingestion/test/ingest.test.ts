/**
 * Canonicalization bridge — 02_CANONICAL_DATA_MODEL.md §6,
 * 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4 ("fail loudly"), 01_SYSTEM_ARCHITECTURE.md §1.
 *
 * `ingest` is the boundary between untrusted source files and the canonical model. It owns
 * provenance — the adapter never gets to state its own hash or ingestion time — and it runs the
 * schema validator on every adapter's output. A malformed log produces an error and no dataset;
 * there is no partially-salvaged result.
 */
import { describe, expect, it } from 'vitest';

import { createSignal, createTimeBase } from '@pandalog/core-domain';
import {
  createAdapterRegistry,
  ingest,
  IngestionError,
  type ParsedFlightData,
  type ParserAdapter,
} from '@pandalog/ingestion';
import { Validity, type Signal, type ValidationIssue } from '@pandalog/schema';

const timeBase = createTimeBase({ origin: 'BOOT' });

/** SHA-256 of the ASCII bytes "abc" — the standard published test vector. */
const ABC_BYTES = Uint8Array.from([0x61, 0x62, 0x63]);
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function goodParse(): ParsedFlightData {
  return {
    vehicle: { frameClass: 'quad', firmwareVersion: '4.5.0', firmwareHash: null },
    timeBase,
    signals: [
      createSignal({
        id: 'attitude.roll',
        unit: 'rad',
        sourceUnit: 'cdeg',
        timeBase,
        samples: [
          { t_rel_seconds: 0, value: 0.1, validity: Validity.VALID },
          { t_rel_seconds: 1, value: NaN, validity: Validity.MISSING },
        ],
      }),
    ],
    sourceEvents: [{ t_rel_seconds: 0.5, type: 'mode-change', payload: { to: 'LOITER' } }],
  };
}

function adapterReturning(parse: ParserAdapter['parse']): ParserAdapter {
  return {
    metadata: {
      packageName: '@pandalog/parser-fake',
      version: '2.3.4',
      format: 'fake-dataflash',
    },
    canParse: () => true,
    parse,
  };
}

const registryWith = (adapter: ParserAdapter) => createAdapterRegistry([adapter]);

const file = { fileName: 'flight.bin', bytes: ABC_BYTES };

describe('ingest', () => {
  it('produces a canonical dataset from an adapter', async () => {
    const dataset = await ingest(file, { registry: registryWith(adapterReturning(goodParse)) });

    expect(dataset.signals.get('attitude.roll')?.unit).toBe('rad');
    expect(dataset.sourceEvents).toHaveLength(1);
    expect(dataset.vehicle.frameClass).toBe('quad');
  });

  describe('provenance is computed, never taken on trust from the adapter', () => {
    it('hashes the actual bytes', async () => {
      const dataset = await ingest(file, { registry: registryWith(adapterReturning(goodParse)) });

      expect(dataset.provenance.sha256).toBe(ABC_SHA256);
    });

    it('records the real size and file name', async () => {
      const dataset = await ingest(file, { registry: registryWith(adapterReturning(goodParse)) });

      expect(dataset.provenance.sizeBytes).toBe(3);
      expect(dataset.provenance.fileName).toBe('flight.bin');
    });

    it('stamps the adapter that produced the data', async () => {
      const dataset = await ingest(file, { registry: registryWith(adapterReturning(goodParse)) });

      expect(dataset.provenance.format).toBe('fake-dataflash');
      expect(dataset.provenance.parserPackage).toBe('@pandalog/parser-fake');
      expect(dataset.provenance.parserVersion).toBe('2.3.4');
    });

    it('stamps an ISO-8601 UTC ingestion time from the injected clock', async () => {
      const dataset = await ingest(file, {
        registry: registryWith(adapterReturning(goodParse)),
        now: () => new Date('2026-03-04T05:06:07.008Z'),
      });

      expect(dataset.provenance.ingestedAtUtc).toBe('2026-03-04T05:06:07.008Z');
    });

    it('is reproducible: the same bytes yield the same hash', async () => {
      const options = { registry: registryWith(adapterReturning(goodParse)) };
      const first = await ingest(file, options);
      const second = await ingest(file, options);

      expect(first.provenance.sha256).toBe(second.provenance.sha256);
    });
  });

  describe('fails loudly', () => {
    it('reports NO_ADAPTER when nothing can parse the file', async () => {
      const registry = createAdapterRegistry([
        { ...adapterReturning(goodParse), canParse: () => false },
      ]);

      await expect(ingest(file, { registry })).rejects.toThrow(IngestionError);
      await expect(ingest(file, { registry })).rejects.toMatchObject({ code: 'NO_ADAPTER' });
    });

    it('rejects an empty source file rather than producing an empty dataset', async () => {
      const registry = registryWith(adapterReturning(goodParse));

      await expect(
        ingest({ fileName: 'empty.bin', bytes: new Uint8Array(0) }, { registry }),
      ).rejects.toMatchObject({ code: 'EMPTY_SOURCE' });
    });

    it('wraps an adapter crash as ADAPTER_FAILED and preserves the cause', async () => {
      const boom = new Error('unexpected FMT record at offset 91');
      const registry = registryWith(
        adapterReturning(() => {
          throw boom;
        }),
      );

      await expect(ingest(file, { registry })).rejects.toMatchObject({
        code: 'ADAPTER_FAILED',
        cause: boom,
      });
    });

    it('wraps a rejected async adapter too', async () => {
      const registry = registryWith(adapterReturning(() => Promise.reject(new Error('truncated'))));

      await expect(ingest(file, { registry })).rejects.toMatchObject({ code: 'ADAPTER_FAILED' });
    });

    it('rejects adapter output that violates the canonical model (doc 02 §6)', async () => {
      // A hand-built Signal bypassing core-domain's constructors: a finite value paired with
      // MISSING. The validator is the reason an adapter cannot smuggle this through.
      const smuggled: Signal = Object.freeze({
        id: 'attitude.roll',
        unit: 'rad',
        sourceUnit: 'cdeg',
        timeBase,
        samples: Object.freeze([
          Object.freeze({ t_rel_seconds: 0, value: 0, validity: Validity.MISSING }),
        ]),
        derived: false,
      });

      const registry = registryWith(
        adapterReturning(() => ({
          vehicle: { frameClass: null, firmwareVersion: null, firmwareHash: null },
          timeBase,
          signals: [smuggled],
        })),
      );

      await expect(ingest(file, { registry })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    });

    it('lists the schema issues it rejected, so an adapter author can fix them', async () => {
      const smuggled: Signal = Object.freeze({
        id: 'a',
        unit: 'rad',
        sourceUnit: null,
        timeBase,
        samples: Object.freeze([
          Object.freeze({ t_rel_seconds: 0, value: 1, validity: Validity.UNSUPPORTED }),
        ]),
        derived: false,
      });

      try {
        await ingest(file, {
          registry: registryWith(
            adapterReturning(() => ({
              vehicle: { frameClass: null, firmwareVersion: null, firmwareHash: null },
              timeBase,
              signals: [smuggled],
            })),
          ),
        });
        expect.unreachable('should have thrown');
      } catch (error) {
        const ingestionError = error as IngestionError;
        expect(ingestionError.code).toBe('SCHEMA_INVALID');

        const issues = ingestionError.context.issues as ValidationIssue[];
        expect(issues.map((issue) => issue.code)).toContain('VALIDITY_VALUE_MISMATCH');
        expect(issues[0]?.path).toBe('signals["a"].samples[0]');
        // The message alone must be actionable, since that is what reaches a log or the UI.
        expect(ingestionError.message).toContain('VALIDITY_VALUE_MISMATCH');
      }
    });

    it('reports a construction failure such as duplicate signal ids', async () => {
      const registry = registryWith(
        adapterReturning(() => {
          const data = goodParse();
          return { ...data, signals: [...data.signals, ...data.signals] };
        }),
      );

      await expect(ingest(file, { registry })).rejects.toMatchObject({
        code: 'ADAPTER_OUTPUT_INVALID',
      });
    });

    it('returns no dataset at all when it fails — never a salvaged partial', async () => {
      const registry = registryWith(
        adapterReturning(() => {
          throw new Error('truncated at record 4020');
        }),
      );

      const result = await ingest(file, { registry }).catch((error: unknown) => error);

      expect(result).toBeInstanceOf(IngestionError);
    });
  });
});
