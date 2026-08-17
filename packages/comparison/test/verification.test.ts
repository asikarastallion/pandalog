/**
 * Verification comparison — doc 03 §3.
 *
 * This is the axis a flight-test engineer reads first: did anything that passed last time stop
 * passing? Two constraints shape it. Outcomes are only comparable when both flights answered the
 * *same* requirement set, and a change in either direction has to be named as a direction rather
 * than reported as an undifferentiated diff.
 */
import { describe, expect, it } from 'vitest';

import { compareVerification } from '@pandalog/comparison';

import { buildVerification } from './support/subjects.js';

const changeFor = (result: ReturnType<typeof compareVerification>, id: string) => {
  const found = result.changes.find((entry) => entry.requirementId === id);
  if (found === undefined) {
    throw new Error(`No change entry for ${id}.`);
  }
  return found;
};

describe('compareVerification', () => {
  it('finds no change between a report and itself', () => {
    const report = buildVerification({
      outcomes: { 'REQ-A': 'PASS', 'REQ-B': 'FAIL', 'REQ-C': 'INCONCLUSIVE' },
    });

    const result = compareVerification(report, report);

    expect(result.verdict).toBe('SAME');
    expect(result.changes.every((change) => change.direction === 'UNCHANGED')).toBe(true);
    expect(result.regressions).toEqual([]);
  });

  it('names a requirement that stopped passing as a regression', () => {
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'PASS' } });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'FAIL' } });

    const result = compareVerification(baseline, subject);

    expect(changeFor(result, 'REQ-A').direction).toBe('REGRESSION');
    expect(result.regressions).toEqual(['REQ-A']);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('treats a requirement that became inconclusive as a regression too', () => {
    // Losing the evidence for a PASS is a loss of assurance. Reporting it as a neutral change would
    // let a flight quietly stop being verified while the summary still looked calm.
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'PASS' } });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'INCONCLUSIVE' } });

    expect(changeFor(compareVerification(baseline, subject), 'REQ-A').direction).toBe('REGRESSION');
  });

  it('names a requirement that started passing as an improvement', () => {
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'FAIL' } });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'PASS' } });

    const result = compareVerification(baseline, subject);

    expect(changeFor(result, 'REQ-A').direction).toBe('IMPROVEMENT');
    expect(result.improvements).toEqual(['REQ-A']);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('keeps a change of applicability separate from a change of verdict', () => {
    // NOT_APPLICABLE is not a better or worse answer than PASS; it says the question was not asked.
    // Ranking it on the same axis would turn "we stopped testing this" into "this improved".
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'PASS' } });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'NOT_APPLICABLE' } });

    const result = compareVerification(baseline, subject);

    expect(changeFor(result, 'REQ-A').direction).toBe('APPLICABILITY_CHANGED');
    expect(result.regressions).toEqual([]);
    expect(result.improvements).toEqual([]);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('reports requirements that only one report answered', () => {
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'PASS', 'REQ-OLD': 'PASS' } });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'PASS', 'REQ-NEW': 'PASS' } });

    const result = compareVerification(baseline, subject);

    expect(changeFor(result, 'REQ-OLD').direction).toBe('REMOVED');
    expect(changeFor(result, 'REQ-NEW').direction).toBe('ADDED');
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('refuses to compare outcomes produced by different requirement sets', () => {
    // Two reports answering different questions can agree on every outcome and mean nothing by it.
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'PASS' }, setId: 'set-one' });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'PASS' }, setId: 'set-two' });

    const result = compareVerification(baseline, subject);

    expect(result.verdict).toBe('INCOMPARABLE');
    expect(result.changes).toEqual([]);
    expect(result.reason).toContain('set-one');
    expect(result.reason).toContain('set-two');
  });

  it('refuses to compare outcomes across two versions of one requirement set', () => {
    const baseline = buildVerification({ outcomes: { 'REQ-A': 'PASS' }, setVersion: '1.0.0' });
    const subject = buildVerification({ outcomes: { 'REQ-A': 'PASS' }, setVersion: '2.0.0' });

    const result = compareVerification(baseline, subject);

    expect(result.verdict).toBe('INCOMPARABLE');
    expect(result.reason).toContain('2.0.0');
  });

  it('orders its changes by requirement id so two runs produce the same report', () => {
    const outcomes = { 'REQ-C': 'PASS', 'REQ-A': 'PASS', 'REQ-B': 'PASS' } as const;
    const report = buildVerification({ outcomes });

    expect(
      compareVerification(report, report).changes.map((change) => change.requirementId),
    ).toEqual(['REQ-A', 'REQ-B', 'REQ-C']);
  });
});
