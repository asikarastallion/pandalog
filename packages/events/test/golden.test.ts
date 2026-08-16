/**
 * Golden event output — 05_IMPLEMENTATION_ROADMAP.md Phase D acceptance:
 *
 * > Detected events on golden fixtures match expected output exactly.
 *
 * Runs the full pipeline the way a user would: ingest a real `.BIN` fixture, then detect. A change
 * anywhere beneath — decoding, unit conversion, validity handling, detector thresholds — shows up
 * as a diff here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createDefaultDetectorRegistry, detectEvents } from '@pandalog/events';
import { createAdapterRegistry, ingest } from '@pandalog/ingestion';
import { arduPilotAdapter } from '@pandalog/parser-ardupilot';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const adapters = createAdapterRegistry([arduPilotAdapter]);
const detectors = createDefaultDetectorRegistry();
const now = () => new Date('2026-01-01T00:00:00.000Z');

const round = (value: number): number => Number(value.toFixed(6));

describe.each(['nominal.bin', 'gps-glitch.bin', 'mode-change-error.bin'])('%s', (name) => {
  const load = async () =>
    ingest(
      { fileName: name, bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))) },
      { registry: adapters, now },
    );

  it('detects the expected events', async () => {
    const events = detectEvents(detectors, { dataset: await load() });

    const serialised = events.map((event) => ({
      id: event.id,
      type: event.type,
      t_start_seconds: round(event.t_start_seconds),
      t_end_seconds: event.t_end_seconds === null ? null : round(event.t_end_seconds),
      sourceSignalIds: event.sourceSignalIds,
      detector: event.detector,
      payload: event.payload,
    }));

    await expect(JSON.stringify(serialised, null, 2)).toMatchFileSnapshot(
      path.join(FIXTURES, `${name.replace(/\.bin$/, '')}.events.json`),
    );
  });

  it('is deterministic across repeated runs (doc 03 §6)', async () => {
    const dataset = await load();

    expect(JSON.stringify(detectEvents(detectors, { dataset }))).toBe(
      JSON.stringify(detectEvents(detectors, { dataset })),
    );
  });
});
