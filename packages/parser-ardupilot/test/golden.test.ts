/**
 * Golden fixture tests — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §5, doc 05 Phase B acceptance.
 *
 * Each committed `.BIN` is paired with the full canonical dataset it must produce, serialised
 * deterministically. Any change to decoding, unit conversion, signal naming or validity handling
 * shows up as a diff in the expected file, which is the point: a silent change in what a flight
 * log *means* is the failure mode these tests exist to prevent.
 *
 * Regenerate deliberately, never reflexively: `pnpm test -u` rewrites the expected files, so a diff
 * must be read and understood before it is accepted.
 */
import { describe, expect, it } from 'vitest';

import { createAdapterRegistry, ingest } from '@pandalog/ingestion';
import { arduPilotAdapter } from '@pandalog/parser-ardupilot';
import type { CanonicalFlightDataset } from '@pandalog/schema';

import { fixtureBytes, fixturePath } from './support/fixtures.js';

const registry = createAdapterRegistry([arduPilotAdapter]);
/** Fixed clock: ingestedAtUtc is the one field that would otherwise differ every run. */
const now = () => new Date('2026-01-01T00:00:00.000Z');

/** Six significant decimals keeps the golden files readable without hiding a real change. */
const round = (value: number): number | string =>
  Number.isFinite(value) ? Number(value.toFixed(6)) : String(value);

function serialize(dataset: CanonicalFlightDataset): unknown {
  return {
    schemaVersion: dataset.schemaVersion,
    provenance: dataset.provenance,
    vehicle: dataset.vehicle,
    timeBase: dataset.timeBase,
    signals: [...dataset.signals.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((signal) => ({
        id: signal.id,
        unit: signal.unit,
        sourceUnit: signal.sourceUnit,
        derived: signal.derived,
        timeBase: signal.timeBase,
        sampleCount: signal.samples.length,
        samples: signal.samples.map((sample) => [
          round(sample.t_rel_seconds),
          round(sample.value),
          sample.validity,
        ]),
      })),
    sourceEvents: dataset.sourceEvents.map((event) => ({
      t_rel_seconds: round(event.t_rel_seconds),
      type: event.type,
      payload: event.payload,
    })),
  };
}

describe.each(['nominal.bin', 'gps-glitch.bin', 'mode-change-error.bin', 'degraded-flight.bin'])(
  '%s',
  (name) => {
    it('produces the expected canonical dataset', async () => {
      const dataset = await ingest(
        { fileName: name, bytes: fixtureBytes(name) },
        { registry, now },
      );

      await expect(JSON.stringify(serialize(dataset), null, 2)).toMatchFileSnapshot(
        fixturePath(`${name.replace(/\.bin$/, '')}.expected.json`),
      );
    });

    it('is reproducible: ingesting twice yields an identical dataset', async () => {
      // doc 03 §6 / doc 04 §7: the same inputs and versions must give the same output, which is what
      // makes a report reproducible rather than merely repeatable-looking.
      const first = await ingest({ fileName: name, bytes: fixtureBytes(name) }, { registry, now });
      const second = await ingest({ fileName: name, bytes: fixtureBytes(name) }, { registry, now });

      expect(JSON.stringify(serialize(first))).toBe(JSON.stringify(serialize(second)));
    });
  },
);
