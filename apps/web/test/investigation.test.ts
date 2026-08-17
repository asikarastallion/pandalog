/**
 * The investigation workflow — 03_ANALYSIS_AND_VERIFICATION.md §5, doc 05 Phase H acceptance:
 *
 * > Selecting a `Finding` in the UI reaches its evidence and opens the correct synchronized time
 * > window against real fixture data.
 *
 * These tests run the whole pipeline over a committed `.BIN` and then do what a click does. They
 * need no browser, because the resolution is a pure function over the pipeline's output — which is
 * doc 04 §1 rule 1 in practice: if selecting a finding could only be tested by rendering a
 * component, the logic would be in the wrong place.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { runPipeline, type PipelineResult } from '@pandalog/pipeline';

import { findingsByTime, openInvestigation } from '../src/workspace/investigation.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const load = (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

describe('against real fixture data (degraded-flight.bin)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await load('degraded-flight.bin');
  });

  it('has findings to investigate in the first place', () => {
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('opens the window the roll finding’s evidence actually points at', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    expect(finding).toBeDefined();

    const investigation = openInvestigation(result, finding?.id ?? '');
    expect(investigation).not.toBeNull();

    // The excursion runs t=[2, 6]; the RMS criterion is cleared partway in and decays after.
    expect(investigation?.window.startSeconds).toBeGreaterThanOrEqual(2);
    expect(investigation?.window.endSeconds).toBeLessThanOrEqual(8);
    expect(investigation?.window.endSeconds).toBeGreaterThan(
      investigation?.window.startSeconds ?? 0,
    );
  });

  it('opens both signals the roll finding cites, not just the measured one', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const investigation = openInvestigation(result, finding?.id ?? '');

    const ids = investigation?.signals.map((signal) => signal.id) ?? [];
    expect(ids).toContain('attitude.roll');
    expect(ids).toContain('attitude.roll.desired');
  });

  it('synchronizes them: every opened sample lies inside the window', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const investigation = openInvestigation(result, finding?.id ?? '');
    expect(investigation).not.toBeNull();

    for (const signal of investigation?.signals ?? []) {
      for (const sample of signal.samples) {
        expect(sample.t_rel_seconds).toBeGreaterThanOrEqual(
          investigation?.window.startSeconds ?? 0,
        );
        expect(sample.t_rel_seconds).toBeLessThanOrEqual(investigation?.window.endSeconds ?? 0);
      }
    }
  });

  it('opens a non-empty view — a window with no samples would be a resolution bug', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const investigation = openInvestigation(result, finding?.id ?? '');

    for (const signal of investigation?.signals ?? []) {
      expect(signal.samples.length, `${signal.id} opened empty`).toBeGreaterThan(0);
    }
  });

  it('reaches the event behind an event-backed finding, and the signals it was detected from', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:gps-availability');
    const investigation = openInvestigation(result, finding?.id ?? '');

    expect(investigation?.citedEvents.map((event) => event.type)).toContain('gps-fix-loss');
    expect(investigation?.signals.map((signal) => signal.id)).toContain('gps.fix_type');
  });

  it('opens the vibration finding across all three axes it was detected from', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:vibration-level');
    const investigation = openInvestigation(result, finding?.id ?? '');

    const ids = investigation?.signals.map((signal) => signal.id) ?? [];
    for (const axis of ['vibration.x', 'vibration.y', 'vibration.z']) {
      expect(ids).toContain(axis);
    }
  });

  it('resolves every finding the flight produced, not just the convenient one', () => {
    for (const finding of result.findings) {
      const investigation = openInvestigation(result, finding.id);

      expect(investigation, `${finding.id} did not resolve`).not.toBeNull();
      expect(investigation?.unresolvedEvidence, `${finding.id} has dangling evidence`).toEqual([]);
      expect(investigation?.signals.length).toBeGreaterThan(0);
    }
  });

  it('adds operator-chosen signals to the same window (doc 03 §5)', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const investigation = openInvestigation(result, finding?.id ?? '', {
      extraSignalIds: ['attitude.pitch'],
    });

    const pitch = investigation?.signals.find((signal) => signal.id === 'attitude.pitch');
    expect(pitch).toBeDefined();
    for (const sample of pitch?.samples ?? []) {
      expect(sample.t_rel_seconds).toBeGreaterThanOrEqual(investigation?.window.startSeconds ?? 0);
    }
  });

  it('pads the window for context without pretending the evidence was wider', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const bare = openInvestigation(result, finding?.id ?? '');
    const padded = openInvestigation(result, finding?.id ?? '', { paddingSeconds: 1 });

    expect(padded?.window.startSeconds).toBeCloseTo((bare?.window.startSeconds ?? 0) - 1, 6);
    expect(padded?.window.endSeconds).toBeCloseTo((bare?.window.endSeconds ?? 0) + 1, 6);
    expect(padded?.evidenceWindow).toEqual(bare?.window);
  });
});

describe('resolution failures are reported, not swallowed', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await load('degraded-flight.bin');
  });

  it('returns null for a finding id that does not exist', () => {
    expect(openInvestigation(result, 'no-such-finding')).toBeNull();
  });

  it('records a signal the evidence names but the dataset lacks', () => {
    const finding = result.findings[0];
    expect(finding).toBeDefined();

    const investigation = openInvestigation(
      { ...result, dataset: { ...result.dataset, signals: new Map() } },
      finding?.id ?? '',
    );

    expect(investigation?.unresolvedSignalIds.length).toBeGreaterThan(0);
    expect(investigation?.signals).toEqual([]);
  });

  it('records an event reference pointing at an event that is not present', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:gps-availability');
    const investigation = openInvestigation({ ...result, events: [] }, finding?.id ?? '');

    expect(investigation?.unresolvedEvidence.map((ref) => ref.kind)).toContain('event');
  });

  it('does not flag a measurement’s signal as missing — the reference carries its own value', () => {
    // The attitude rule cites the RMS error series it derived (doc 02 §5: a separate artifact, not
    // part of the dataset). Doc 03 §2 gives a measurement reference `value` and `unit` of its own,
    // so it is evidence in itself; treating it as a dangling pointer would cry wolf on every
    // finding of this shape.
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const investigation = openInvestigation(result, finding?.id ?? '');

    const derivedIds = finding?.evidence
      .filter((ref) => ref.kind === 'measurement')
      .map((ref) => ref.signalId);

    expect(derivedIds?.length).toBeGreaterThan(0);
    for (const id of derivedIds ?? []) {
      expect(investigation?.unresolvedSignalIds).not.toContain(id);
    }
  });

  it('still flags a signal-window whose signal is absent — that one is a real hole', () => {
    const finding = result.findings.find((f) => f.ruleId === 'analysis:attitude-tracking-error');
    const windowIds = finding?.evidence
      .filter((ref) => ref.kind === 'signal-window')
      .map((ref) => ref.signalId);

    const investigation = openInvestigation(
      { ...result, dataset: { ...result.dataset, signals: new Map() } },
      finding?.id ?? '',
    );

    for (const id of windowIds ?? []) {
      expect(investigation?.unresolvedSignalIds).toContain(id);
    }
  });

  it('ignores an operator-chosen signal that is not in the dataset', () => {
    const finding = result.findings[0];
    const investigation = openInvestigation(result, finding?.id ?? '', {
      extraSignalIds: ['not.a.signal'],
    });

    expect(investigation?.signals.map((s) => s.id)).not.toContain('not.a.signal');
    expect(investigation?.unresolvedSignalIds).toContain('not.a.signal');
  });
});

describe('findingsByTime', () => {
  it('orders findings by when they happened, which is how an engineer reads a flight', async () => {
    const result = await load('degraded-flight.bin');
    const ordered = findingsByTime(result.findings);

    const starts = ordered.map((entry) => entry.startSeconds);
    expect([...starts]).toEqual([...starts].sort((a, b) => a - b));
  });

  it('keeps a finding whose evidence carries no time, rather than dropping it', () => {
    const timeless = {
      id: 'f-timeless',
      ruleId: 'analysis:test',
      ruleVersion: '1.0.0',
      statement: 'something',
      severity: 'INFO' as const,
      evidence: [{ kind: 'event' as const, eventId: 'e1' }],
      measurements: [],
      thresholds: [],
      producedAtUtc: '2026-01-01T00:00:00.000Z',
    };

    expect(findingsByTime([timeless])).toHaveLength(1);
  });
});
