/**
 * The ArduPilot adapter, exercised through the real ingestion pipeline.
 *
 * These tests call `ingest` rather than the adapter directly, because what matters is that a
 * `.BIN` file becomes a *validated* canonical dataset — the schema validator runs at that boundary
 * (doc 02 §6), and it is the reason an adapter cannot quietly emit something the model forbids.
 */
import { describe, expect, it } from 'vitest';

import { createAdapterRegistry, ingest, IngestionError } from '@pandalog/ingestion';
import { arduPilotAdapter, toParsedFlightData, decodeDataflash } from '@pandalog/parser-ardupilot';
import { Validity, validateCanonicalFlightDataset } from '@pandalog/schema';

import { fixtureBytes } from './support/fixtures.js';

const registry = createAdapterRegistry([arduPilotAdapter]);
const now = () => new Date('2026-01-01T00:00:00.000Z');

const ingestFixture = async (name: string) =>
  ingest({ fileName: name, bytes: fixtureBytes(name) }, { registry, now });

describe('canParse', () => {
  it('accepts a file starting with the DataFlash packet header', () => {
    expect(
      arduPilotAdapter.canParse({ fileName: 'x.bin', bytes: fixtureBytes('nominal.bin') }),
    ).toBe(true);
  });

  it('rejects a text .log rendering rather than attempting a lossy decode (ADR-0009)', () => {
    const text = new TextEncoder().encode('FMT, 128, 89, FMT, BBnNZ, Type,Length,Name\n');

    expect(arduPilotAdapter.canParse({ fileName: 'flight.log', bytes: text })).toBe(false);
  });

  it('rejects a file too short to hold a header', () => {
    expect(arduPilotAdapter.canParse({ fileName: 'x.bin', bytes: Uint8Array.from([0xa3]) })).toBe(
      false,
    );
  });
});

describe('ingesting a nominal flight', () => {
  it('produces a dataset the schema validator accepts', async () => {
    const dataset = await ingestFixture('nominal.bin');

    expect(validateCanonicalFlightDataset(dataset).issues).toEqual([]);
  });

  it('stamps provenance from the real bytes and the adapter', async () => {
    const dataset = await ingestFixture('nominal.bin');

    expect(dataset.provenance.format).toBe('ardupilot-dataflash');
    expect(dataset.provenance.parserPackage).toBe('@pandalog/parser-ardupilot');
    expect(dataset.provenance.sizeBytes).toBe(fixtureBytes('nominal.bin').length);
    expect(dataset.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('declares a boot-relative time base with unknown UTC synchronisation', async () => {
    const dataset = await ingestFixture('nominal.bin');

    expect(dataset.timeBase.origin).toBe('BOOT');
    // Null, not 0: the log gives no basis for claiming the boot clock tracks UTC.
    expect(dataset.timeBase.syncUncertaintySeconds).toBeNull();
  });

  it('maps ArduPilot fields onto canonical signal ids', async () => {
    const dataset = await ingestFixture('nominal.bin');

    expect([...dataset.signals.keys()].sort()).toContain('attitude.roll');
    expect([...dataset.signals.keys()].sort()).toContain('baro.pressure');
    expect([...dataset.signals.keys()].sort()).toContain('gps.latitude');
  });

  it('converts degrees to canonical radians through core-domain', async () => {
    const dataset = await ingestFixture('nominal.bin');
    const roll = dataset.signals.get('attitude.roll');

    expect(roll?.unit).toBe('rad');
    expect(roll?.sourceUnit).toBe('deg');
    // The generator wrote roll = 5*sin(0) + 0.2 = 0.2 degrees for the first sample.
    expect(roll?.samples[0]?.value).toBeCloseTo((0.2 * Math.PI) / 180, 6);
  });

  it('converts timestamps from microseconds to seconds', async () => {
    const dataset = await ingestFixture('nominal.bin');
    const roll = dataset.signals.get('attitude.roll');

    expect(roll?.samples[0]?.t_rel_seconds).toBe(0);
    expect(roll?.samples[1]?.t_rel_seconds).toBeCloseTo(0.1, 9);
  });

  it('keeps pressure in pascals, which is already canonical', async () => {
    const dataset = await ingestFixture('nominal.bin');
    const pressure = dataset.signals.get('baro.pressure');

    expect(pressure?.unit).toBe('Pa');
    expect(pressure?.samples[0]?.value).toBeCloseTo(101325, 0);
  });

  it('converts barometer temperature from Celsius to kelvin', async () => {
    const dataset = await ingestFixture('nominal.bin');
    const temperature = dataset.signals.get('baro.temperature');

    expect(temperature?.unit).toBe('K');
    expect(temperature?.samples[0]?.value).toBeCloseTo(21.5 + 273.15, 6);
  });

  it('records the mode change as a source event, not a signal', async () => {
    const dataset = await ingestFixture('nominal.bin');

    expect(dataset.sourceEvents.map((event) => event.type)).toEqual(['mode-change']);
    expect(dataset.signals.has('mode')).toBe(false);
  });
});

describe('a declared but never logged message type', () => {
  it('surfaces as UNSUPPORTED, not MISSING and not a default value', async () => {
    // Phase B acceptance: VIBE is in the format table of gps-glitch.bin but no VIBE record exists.
    const dataset = await ingestFixture('gps-glitch.bin');
    const vibration = dataset.signals.get('vibration.x');

    expect(vibration).toBeDefined();
    expect(vibration?.samples[0]?.validity).toBe(Validity.UNSUPPORTED);
    expect(vibration?.samples[0]?.value).toBeNaN();
  });

  it('does not invent a value of zero for it', async () => {
    const dataset = await ingestFixture('gps-glitch.bin');

    for (const id of ['vibration.x', 'vibration.y', 'vibration.z']) {
      const samples = dataset.signals.get(id)?.samples ?? [];
      expect(samples.every((sample) => Number.isNaN(sample.value))).toBe(true);
    }
  });
});

describe('a GPS glitch', () => {
  it('keeps a NaN logged by the vehicle as INVALID with NaN, never as 0', async () => {
    const dataset = await ingestFixture('gps-glitch.bin');
    const speed = dataset.signals.get('gps.ground_speed');
    const invalid = speed?.samples.filter((sample) => sample.validity === Validity.INVALID) ?? [];

    expect(invalid.length).toBe(3);
    expect(invalid.every((sample) => Number.isNaN(sample.value))).toBe(true);
  });

  it('keeps the surrounding valid samples valid', async () => {
    const dataset = await ingestFixture('gps-glitch.bin');
    const speed = dataset.signals.get('gps.ground_speed');

    expect(speed?.samples[0]?.validity).toBe(Validity.VALID);
    expect(speed?.samples[0]?.value).toBeCloseTo(3.9, 5);
  });

  it('records the satellite count dropping to zero as a real measurement', async () => {
    // Zero satellites is a genuine reading, not missing data — it must stay VALID.
    const dataset = await ingestFixture('gps-glitch.bin');
    const satellites = dataset.signals.get('gps.satellites');
    const zeroes = satellites?.samples.filter((sample) => sample.value === 0) ?? [];

    expect(zeroes.length).toBe(3);
    expect(zeroes.every((sample) => sample.validity === Validity.VALID)).toBe(true);
  });
});

describe('mode changes and errors', () => {
  it('captures every discrete event in order', async () => {
    const dataset = await ingestFixture('mode-change-error.bin');

    expect(dataset.sourceEvents.map((event) => event.type)).toEqual([
      'message',
      'mode-change',
      'mode-change',
      'error',
      'mode-change',
    ]);
  });

  it('timestamps events on the same axis as the signals', async () => {
    const dataset = await ingestFixture('mode-change-error.bin');
    const error = dataset.sourceEvents.find((event) => event.type === 'error');

    expect(error?.t_rel_seconds).toBeCloseTo(2.0, 9);
  });

  it('carries the event payload through without interpreting it', async () => {
    const dataset = await ingestFixture('mode-change-error.bin');
    const error = dataset.sourceEvents.find((event) => event.type === 'error');

    expect(error?.payload).toEqual({ Subsys: 11, ECode: 2 });
  });
});

describe('malformed input reaches the caller as a structured ingestion failure', () => {
  it('wraps a truncated log as ADAPTER_FAILED with the parse error as cause', async () => {
    const truncated = fixtureBytes('nominal.bin').slice(0, 500);

    await expect(
      ingest({ fileName: 'cut.bin', bytes: truncated }, { registry, now }),
    ).rejects.toMatchObject({ code: 'ADAPTER_FAILED' });
  });

  it('returns no dataset for a malformed log', async () => {
    const corrupted = Uint8Array.from(fixtureBytes('nominal.bin'));
    corrupted[4] = 99;

    const outcome = await ingest(
      { fileName: 'bad.bin', bytes: corrupted },
      { registry, now },
    ).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(IngestionError);
  });
});

describe('diagnostics', () => {
  it('reports fields it decoded but has no canonical mapping for', () => {
    // Nothing is silently dropped: a field with no catalog entry is named, so the gap is visible.
    const result = toParsedFlightData(decodeDataflash(fixtureBytes('nominal.bin')));

    expect(result.diagnostics.unmappedFields).toContain('GPS.GMS');
    expect(result.diagnostics.unmappedFields).toContain('GPS.GWk');
  });

  it('does not report fields that are mapped', () => {
    const result = toParsedFlightData(decodeDataflash(fixtureBytes('nominal.bin')));

    expect(result.diagnostics.unmappedFields).not.toContain('ATT.Roll');
  });
});
