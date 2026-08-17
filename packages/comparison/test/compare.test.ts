/**
 * The comparison report — 05_IMPLEMENTATION_ROADMAP.md Phase J.
 *
 * The rule these tests exist for: **an axis that was not compared is never "no material
 * difference".** It is the same refusal `@pandalog/verification` makes about evidence, applied to
 * the next question along, and without it a comparison that quietly failed reads exactly like a
 * comparison that succeeded and found nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  compareFlights,
  DEFAULT_EVENT_TIMING_TOLERANCE,
  DEFAULT_SIGNAL_TOLERANCE,
} from '@pandalog/comparison';

import { buildSubject, FLAT, now, NOW } from './support/subjects.js';

const baselineSubject = () =>
  buildSubject({
    label: 'baseline',
    events: [{ type: 'mode-change', startSeconds: 1 }],
    findings: [{ ruleId: 'rule.attitude', severity: 'WARNING', startSeconds: 2 }],
    verification: { outcomes: { 'REQ-A': 'PASS', 'REQ-B': 'FAIL' } },
  });

describe('compareFlights', () => {
  it('reports no material difference on any axis when a flight is compared with itself', () => {
    const subject = baselineSubject();

    const report = compareFlights({ baseline: subject, subject, now });

    expect(report.signals.verdict).toBe('SAME');
    expect(report.events.verdict).toBe('SAME');
    expect(report.findings.verdict).toBe('SAME');
    expect(report.verification.verdict).toBe('SAME');
    expect(report.verdict).toBe('SAME');
  });

  it('stamps the report with the labels and clock it was given', () => {
    const report = compareFlights({
      baseline: buildSubject({ label: 'flight-042' }),
      subject: buildSubject({ label: 'flight-043' }),
      now,
    });

    expect(report.baselineLabel).toBe('flight-042');
    expect(report.subjectLabel).toBe('flight-043');
    expect(report.comparedAtUtc).toBe(NOW);
  });

  it('is different overall as soon as one axis is different', () => {
    const report = compareFlights({
      baseline: baselineSubject(),
      subject: buildSubject({
        label: 'subject',
        events: [{ type: 'mode-change', startSeconds: 1 }],
        findings: [{ ruleId: 'rule.attitude', severity: 'WARNING', startSeconds: 2 }],
        verification: { outcomes: { 'REQ-A': 'FAIL', 'REQ-B': 'FAIL' } },
      }),
      now,
    });

    expect(report.signals.verdict).toBe('SAME');
    expect(report.verification.verdict).toBe('DIFFERENT');
    expect(report.verdict).toBe('DIFFERENT');
  });

  it('never claims overall sameness while an axis went uncompared', () => {
    // Every other axis matches. The verification axis could not be compared at all, and a bare
    // "SAME" would tell a reader the flights were equivalent on a question nobody answered.
    const report = compareFlights({
      baseline: buildSubject({
        label: 'a',
        verification: { outcomes: { 'REQ-A': 'PASS' }, setId: 'set-one' },
      }),
      subject: buildSubject({
        label: 'b',
        verification: { outcomes: { 'REQ-A': 'PASS' }, setId: 'set-two' },
      }),
      now,
    });

    expect(report.signals.verdict).toBe('SAME');
    expect(report.verification.verdict).toBe('INCOMPARABLE');
    expect(report.verdict).toBe('INCOMPARABLE');
  });

  it('still reports a real difference even when another axis is incomparable', () => {
    // An incomparable axis must not mask a difference that was actually established.
    const report = compareFlights({
      baseline: buildSubject({
        label: 'a',
        findings: [{ ruleId: 'rule.attitude', severity: 'WARNING', startSeconds: 2 }],
        verification: { outcomes: { 'REQ-A': 'PASS' }, setId: 'set-one' },
      }),
      subject: buildSubject({
        label: 'b',
        findings: [],
        verification: { outcomes: { 'REQ-A': 'PASS' }, setId: 'set-two' },
      }),
      now,
    });

    expect(report.findings.verdict).toBe('DIFFERENT');
    expect(report.verdict).toBe('DIFFERENT');
  });

  it('publishes every threshold it judged materiality against, with its basis', () => {
    // Doc 03 §4: a number that decides an outcome must say where it came from. These are
    // provisional, and the report says so rather than presenting them as engineering criteria.
    const subject = baselineSubject();
    const report = compareFlights({ baseline: subject, subject, now });

    expect(report.tolerances).toEqual([DEFAULT_SIGNAL_TOLERANCE, DEFAULT_EVENT_TIMING_TOLERANCE]);
    expect(report.tolerances.every((tolerance) => tolerance.basis === 'provisional')).toBe(true);
  });

  it('honours a caller-supplied tolerance and reports the one it used', () => {
    const baseline = buildSubject({ label: 'a' });
    const subject = buildSubject({
      label: 'b',
      dataset: {
        signals: [{ id: 'sensor.a', at: (t) => Math.sin(t) + 0.5 }, ...FLAT.signals.slice(1)],
      },
    });

    const strict = compareFlights({ baseline, subject, now });
    const loose = compareFlights({
      baseline,
      subject,
      now,
      options: {
        signalTolerance: {
          label: 'signal difference, as a fraction of the baseline signal range',
          value: 0.5,
          unit: 'fraction',
          basis: 'empirical:accepted-run-to-run-scatter',
        },
      },
    });

    expect(strict.signals.verdict).toBe('DIFFERENT');
    expect(loose.signals.verdict).toBe('SAME');
    expect(loose.tolerances[0]?.basis).toBe('empirical:accepted-run-to-run-scatter');
  });

  it('rejects a tolerance that cannot decide anything', () => {
    const subject = baselineSubject();

    expect(() =>
      compareFlights({
        baseline: subject,
        subject,
        now,
        options: {
          signalTolerance: {
            label: 'nonsense',
            value: -1,
            unit: 'fraction',
            basis: 'provisional',
          },
        },
      }),
    ).toThrow(/negative/i);
  });

  it('rejects a tolerance that does not say where it came from', () => {
    const subject = baselineSubject();

    expect(() =>
      compareFlights({
        baseline: subject,
        subject,
        now,
        options: {
          signalTolerance: {
            label: 'unjustified',
            value: 0.1,
            unit: 'fraction',
            // A basis outside doc 03 §4's vocabulary; `provisional` is allowed, silence is not.
            basis: 'because I said so' as never,
          },
        },
      }),
    ).toThrow(/basis/i);
  });

  it('produces the same report twice from the same inputs', () => {
    const baseline = baselineSubject();
    const subject = buildSubject({
      label: 'subject',
      events: [{ type: 'gps-fix-loss', startSeconds: 3 }],
      verification: { outcomes: { 'REQ-A': 'FAIL', 'REQ-B': 'FAIL' } },
    });

    const first = compareFlights({ baseline, subject, now });
    const second = compareFlights({ baseline, subject, now });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
