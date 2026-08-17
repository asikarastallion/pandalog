/**
 * Phase J acceptance — 05_IMPLEMENTATION_ROADMAP.md:
 *
 * > Comparing a fixture against itself yields "no material difference" on every axis (signals,
 * > events, findings, verification) — a self-consistency test.
 *
 * Run alone, that criterion is passed by a comparator that returns SAME unconditionally. So every
 * self-comparison here is paired with a cross-comparison that must come back DIFFERENT, and the
 * pairing is what makes the green result mean something (doc 04 §5).
 *
 * These run against real fixture bytes through the whole pipeline rather than against synthetic
 * objects, so the comparison is exercised on the shapes ingestion actually produces.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { describe, expect, it } from 'vitest';

import { compareFlights, type ComparisonSubject } from '@pandalog/comparison';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const now = () => new Date('2026-01-01T00:00:00.000Z');

async function flight(name: string): Promise<ComparisonSubject> {
  const result: PipelineResult = await runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now,
  });
  return { label: name, ...result };
}

const FIXTURE_NAMES = [
  'nominal.bin',
  'degraded-flight.bin',
  'gps-glitch.bin',
  'mode-change-error.bin',
];

describe('comparing a fixture against itself', () => {
  it.each(FIXTURE_NAMES)('finds no material difference in %s', async (name) => {
    const subject = await flight(name);

    const report = compareFlights({ baseline: subject, subject, now });

    expect(report.signals.verdict).toBe('SAME');
    expect(report.events.verdict).toBe('SAME');
    expect(report.findings.verdict).toBe('SAME');
    expect(report.verification.verdict).toBe('SAME');
    expect(report.verdict).toBe('SAME');
  });

  it('actually compared something, rather than passing by having nothing to check', async () => {
    // The failure this guards: a comparison that silently found no signals, no events and no
    // requirements would report SAME on every axis and prove nothing at all.
    const subject = await flight('degraded-flight.bin');
    const report = compareFlights({ baseline: subject, subject, now });

    expect(report.signals.differences.length).toBeGreaterThan(0);
    expect(report.events.matched.length).toBeGreaterThan(0);
    expect(report.findings.changes.length).toBeGreaterThan(0);
    expect(report.verification.changes.length).toBeGreaterThan(0);
  });

  it('lines up every signal, leaving none unmatched', async () => {
    const subject = await flight('nominal.bin');
    const report = compareFlights({ baseline: subject, subject, now });

    expect(report.signals.onlyInBaseline).toEqual([]);
    expect(report.signals.onlyInSubject).toEqual([]);
  });

  it('names the signals it could not examine instead of folding them into the verdict', async () => {
    // gps-glitch.bin carries a VIBE record with nothing usable in it, so those three signals have
    // no data on either side. The axis is still SAME — fourteen signals were compared point by
    // point — and the three that were not are listed rather than quietly counted as agreeing.
    const subject = await flight('gps-glitch.bin');
    const report = compareFlights({ baseline: subject, subject, now });

    expect(report.signals.verdict).toBe('SAME');
    expect([...report.signals.incomparable]).toEqual(['vibration.x', 'vibration.y', 'vibration.z']);
    for (const signalId of report.signals.incomparable) {
      const entry = report.signals.differences.find((item) => item.signalId === signalId);
      expect(entry?.verdict).toBe('INCOMPARABLE');
      expect(entry?.reason).toMatch(/nothing to compare/i);
    }
  });
});

describe('comparing two different fixtures', () => {
  it('separates a degraded flight from a nominal one', async () => {
    const [baseline, subject] = await Promise.all([
      flight('nominal.bin'),
      flight('degraded-flight.bin'),
    ]);

    const report = compareFlights({ baseline, subject, now });

    expect(report.verdict).toBe('DIFFERENT');
  });

  it('names the requirements the degraded flight stopped meeting', async () => {
    const [baseline, subject] = await Promise.all([
      flight('nominal.bin'),
      flight('degraded-flight.bin'),
    ]);

    const report = compareFlights({ baseline, subject, now });

    // The degraded fixture carries a roll excursion, a GNSS outage and a vibration excursion, so at
    // least one requirement that held in the nominal flight must not hold here.
    expect(report.verification.regressions.length).toBeGreaterThan(0);
  });

  it('reports the findings the degraded flight raised and the nominal one did not', async () => {
    const [baseline, subject] = await Promise.all([
      flight('nominal.bin'),
      flight('degraded-flight.bin'),
    ]);

    const report = compareFlights({ baseline, subject, now });
    const introduced = report.findings.changes.filter((change) => change.kind === 'NEW');

    expect(introduced.length).toBeGreaterThan(0);
    expect(report.findings.verdict).toBe('DIFFERENT');
  });

  it('reports the GNSS outage as an event the baseline flight did not have', async () => {
    const [baseline, subject] = await Promise.all([
      flight('nominal.bin'),
      flight('degraded-flight.bin'),
    ]);

    const report = compareFlights({ baseline, subject, now });
    const gained = report.events.countsByType.filter((entry) => entry.subject > entry.baseline);

    expect(gained.length).toBeGreaterThan(0);
    expect(report.events.verdict).toBe('DIFFERENT');
  });

  it('measures how far the degraded flight left the baseline on a shared signal', async () => {
    const [baseline, subject] = await Promise.all([
      flight('nominal.bin'),
      flight('degraded-flight.bin'),
    ]);

    const report = compareFlights({ baseline, subject, now });
    const exceeding = report.signals.differences.filter((entry) => entry.verdict === 'DIFFERENT');

    expect(exceeding.length).toBeGreaterThan(0);
    // A difference is a measurement, not just a flag: every one of them says how big it was and
    // when it first left tolerance.
    for (const entry of exceeding) {
      if (entry.aligned !== null) {
        expect(Number.isFinite(entry.aligned.maxAbsoluteDifference)).toBe(true);
        expect(entry.aligned.firstExceedanceSeconds).not.toBeNull();
      }
    }
  });
});
