/**
 * Cross-field validity: a position is only a measurement when the receiver had a fix.
 *
 * ArduPilot writes `Lat`/`Lng`/`Alt` as `0` when the GNSS receiver has no fix. Passed through
 * literally, that is a finite number with `Validity.VALID` — a canonical dataset asserting the
 * aircraft was at 0°N 0°E, several hundred kilometres off the coast of Ghana, and every consumer
 * downstream believing it. A ground track would fly there and back; a playback scrubber would put
 * the vehicle there; an analysis rule would compute a real distance to it.
 *
 * That is doc 04 §1 rule 6 — "missing/invalid data is never coerced to zero or a default" —
 * happening in reverse: the zero is already in the log, and the parser is the only layer holding
 * both the coordinate and the `Status` field that says it means nothing.
 */
import { describe, expect, it } from 'vitest';

import { createAdapterRegistry, ingest } from '@pandalog/ingestion';
import { arduPilotAdapter } from '@pandalog/parser-ardupilot';
import { Validity } from '@pandalog/schema';

import { fixtureBytes } from './support/fixtures.js';

const registry = createAdapterRegistry([arduPilotAdapter]);
const now = () => new Date('2026-01-01T00:00:00.000Z');

const ingestFixture = async (name: string) =>
  ingest({ fileName: name, bytes: fixtureBytes(name) }, { registry, now });

describe('GPS position during a fix loss', () => {
  it('is INVALID, not a valid reading of zero', async () => {
    const dataset = await ingestFixture('degraded-flight.bin');
    const latitude = dataset.signals.get('gps.latitude');

    const duringOutage = latitude?.samples.filter(
      (sample) => sample.t_rel_seconds >= 3 && sample.t_rel_seconds < 6,
    );

    expect(duringOutage?.length).toBeGreaterThan(0);
    for (const sample of duringOutage ?? []) {
      expect(sample.validity, `t=${String(sample.t_rel_seconds)}`).toBe(Validity.INVALID);
      expect(Number.isNaN(sample.value)).toBe(true);
    }
  });

  it('applies to longitude and altitude too, not just latitude', async () => {
    const dataset = await ingestFixture('degraded-flight.bin');

    for (const id of ['gps.longitude', 'gps.altitude']) {
      const during = dataset.signals
        .get(id)
        ?.samples.find((sample) => sample.t_rel_seconds >= 3 && sample.t_rel_seconds < 6);

      expect(during?.validity, id).toBe(Validity.INVALID);
    }
  });

  it('leaves the position valid while the fix is held', async () => {
    const dataset = await ingestFixture('degraded-flight.bin');
    const latitude = dataset.signals.get('gps.latitude');

    const beforeOutage = latitude?.samples.filter((sample) => sample.t_rel_seconds < 3);

    expect(beforeOutage?.length).toBeGreaterThan(0);
    for (const sample of beforeOutage ?? []) {
      expect(sample.validity).toBe(Validity.VALID);
      expect(Number.isFinite(sample.value)).toBe(true);
    }
  });

  it('keeps the fix type itself valid — it is the measurement that tells us', async () => {
    const dataset = await ingestFixture('degraded-flight.bin');
    const fixType = dataset.signals.get('gps.fix_type');

    for (const sample of fixType?.samples ?? []) {
      expect(sample.validity).toBe(Validity.VALID);
    }
  });

  it('keeps the diagnostic fields valid — satellite count is measured either way', async () => {
    const dataset = await ingestFixture('degraded-flight.bin');

    for (const id of ['gps.satellites', 'gps.hdop']) {
      const during = dataset.signals
        .get(id)
        ?.samples.find((sample) => sample.t_rel_seconds >= 3 && sample.t_rel_seconds < 6);

      expect(during?.validity, id).toBe(Validity.VALID);
    }
  });

  it('does not disturb a flight that never loses its fix', async () => {
    const dataset = await ingestFixture('nominal.bin');
    const latitude = dataset.signals.get('gps.latitude');

    expect(latitude?.samples.every((sample) => sample.validity === Validity.VALID)).toBe(true);
  });

  it('gates the short glitch in gps-glitch.bin as well', async () => {
    const dataset = await ingestFixture('gps-glitch.bin');
    const latitude = dataset.signals.get('gps.latitude');

    const gated = latitude?.samples.filter((sample) => sample.validity === Validity.INVALID);

    expect(gated?.length).toBe(3);
  });
});
