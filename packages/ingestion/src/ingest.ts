/**
 * The canonicalization bridge — 01_SYSTEM_ARCHITECTURE.md §1, 02_CANONICAL_DATA_MODEL.md §6.
 *
 * This is the only supported route from a source file to a `CanonicalFlightDataset`. It:
 *
 *   1. rejects input it cannot meaningfully decode (doc 04 §8: logs are untrusted);
 *   2. selects an adapter and lets it decode;
 *   3. computes provenance itself, rather than trusting the adapter's account of what it read;
 *   4. assembles the dataset through core-domain's constructors;
 *   5. validates the result against the schema and refuses to return an invalid one.
 *
 * Step 5 is required by doc 02 §6 even though core-domain's constructors already enforce the
 * per-sample invariants: an adapter can hand back a `Signal` it assembled by hand, bypassing those
 * constructors, and this is the check that catches it.
 */
import { createCanonicalFlightDataset } from '@pandalog/core-domain';
import { validateCanonicalFlightDataset, type CanonicalFlightDataset } from '@pandalog/schema';

import type { ParsedFlightData, SourceFile } from './adapter.js';
import { sha256Hex } from './digest.js';
import { IngestionError } from './errors.js';
import type { ParserAdapterRegistry } from './registry.js';

export interface IngestOptions {
  readonly registry: ParserAdapterRegistry;
  /**
   * Clock used for `provenance.ingestedAtUtc`. Injected so ingestion is testable and so a caller
   * can pin the timestamp when reproducing a historical run.
   */
  readonly now?: () => Date;
}

/**
 * Ingest a source file into the canonical model.
 *
 * @throws {IngestionError} for every failure mode. No partial dataset is ever returned; a failed
 * ingestion yields an error and nothing else.
 */
export async function ingest(
  file: SourceFile,
  options: IngestOptions,
): Promise<CanonicalFlightDataset> {
  if (file.bytes.length === 0) {
    throw new IngestionError(
      'EMPTY_SOURCE',
      `Source file ${JSON.stringify(file.fileName)} is empty; there is nothing to decode.`,
      { context: { fileName: file.fileName } },
    );
  }

  const adapter = options.registry.select(file);
  if (adapter === null) {
    throw new IngestionError(
      'NO_ADAPTER',
      `No registered parser adapter claims ${JSON.stringify(file.fileName)}. ` +
        `Registered formats: ${
          options.registry.adapters.map((entry) => entry.metadata.format).join(', ') || '(none)'
        }.`,
      {
        context: {
          fileName: file.fileName,
          registeredFormats: options.registry.adapters.map((entry) => entry.metadata.format),
        },
      },
    );
  }

  let parsed: ParsedFlightData;
  try {
    parsed = await adapter.parse(file);
  } catch (error) {
    throw new IngestionError(
      'ADAPTER_FAILED',
      `${adapter.metadata.packageName} failed to decode ${JSON.stringify(file.fileName)}. ` +
        'No dataset is produced; a malformed log is never partially salvaged.',
      {
        cause: error,
        context: { fileName: file.fileName, format: adapter.metadata.format },
      },
    );
  }

  const sha256 = await sha256Hex(file.bytes);
  const ingestedAtUtc = (options.now?.() ?? new Date()).toISOString();

  let dataset: CanonicalFlightDataset;
  try {
    dataset = createCanonicalFlightDataset({
      provenance: {
        fileName: file.fileName,
        sha256,
        sizeBytes: file.bytes.length,
        format: adapter.metadata.format,
        parserPackage: adapter.metadata.packageName,
        parserVersion: adapter.metadata.version,
        ingestedAtUtc,
      },
      vehicle: parsed.vehicle,
      timeBase: parsed.timeBase,
      signals: parsed.signals,
      ...(parsed.sourceEvents === undefined ? {} : { sourceEvents: parsed.sourceEvents }),
    });
  } catch (error) {
    throw new IngestionError(
      'ADAPTER_OUTPUT_INVALID',
      `${adapter.metadata.packageName} returned data that could not be assembled into a canonical ` +
        `dataset for ${JSON.stringify(file.fileName)}.`,
      {
        cause: error,
        context: { fileName: file.fileName, format: adapter.metadata.format },
      },
    );
  }

  // doc 02 §6: run the validator on every adapter's output; a failing dataset is a hard error.
  const validation = validateCanonicalFlightDataset(dataset);
  if (!validation.valid) {
    throw new IngestionError(
      'SCHEMA_INVALID',
      `${adapter.metadata.packageName} produced a dataset that violates the canonical model: ` +
        validation.issues.map((issue) => `${issue.code} at ${issue.path}`).join('; '),
      {
        context: {
          fileName: file.fileName,
          format: adapter.metadata.format,
          issues: validation.issues,
        },
      },
    );
  }

  return dataset;
}
