/**
 * Finding comparison — doc 03 §2.
 *
 * Findings are matched by the rule that produced them, because that is the question being asked
 * twice. What counts as a material difference is the rule's own severity, not a number this package
 * invented: a rule that fired at WARNING in both flights reached the same conclusion, whatever the
 * underlying measurement did in between.
 */
import { describe, expect, it } from 'vitest';

import { compareFindings } from '@pandalog/comparison';

import { buildFinding, type FindingSpec } from './support/subjects.js';

const findings = (specs: readonly FindingSpec[]) => specs.map(buildFinding);

const changeFor = (result: ReturnType<typeof compareFindings>, ruleId: string) => {
  const found = result.changes.find((entry) => entry.ruleId === ruleId);
  if (found === undefined) {
    throw new Error(`No change entry for ${ruleId}.`);
  }
  return found;
};

describe('compareFindings', () => {
  it('finds nothing changed between a flight and itself', () => {
    const set = findings([
      { ruleId: 'rule.attitude', severity: 'WARNING', startSeconds: 2 },
      { ruleId: 'rule.vibration', severity: 'ADVISORY', startSeconds: 5 },
    ]);

    const result = compareFindings(set, set);

    expect(result.verdict).toBe('SAME');
    expect(result.changes.every((change) => change.kind === 'UNCHANGED')).toBe(true);
  });

  it('reports a finding the subject flight raised and the baseline did not', () => {
    const baseline = findings([{ ruleId: 'rule.attitude', severity: 'WARNING', startSeconds: 2 }]);
    const subject = findings([
      { ruleId: 'rule.attitude', severity: 'WARNING', startSeconds: 2 },
      { ruleId: 'rule.vibration', severity: 'CRITICAL', startSeconds: 5 },
    ]);

    const result = compareFindings(baseline, subject);

    expect(changeFor(result, 'rule.vibration').kind).toBe('NEW');
    expect(changeFor(result, 'rule.vibration').baselineSeverity).toBeNull();
    expect(changeFor(result, 'rule.vibration').subjectSeverity).toBe('CRITICAL');
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('reports a finding that no longer fires as resolved', () => {
    const baseline = findings([{ ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 5 }]);

    const result = compareFindings(baseline, []);

    expect(changeFor(result, 'rule.vibration').kind).toBe('RESOLVED');
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('reports a severity change as the material difference it is', () => {
    const baseline = findings([
      { ruleId: 'rule.vibration', severity: 'ADVISORY', startSeconds: 5 },
    ]);
    const subject = findings([{ ruleId: 'rule.vibration', severity: 'CRITICAL', startSeconds: 5 }]);

    const change = changeFor(compareFindings(baseline, subject), 'rule.vibration');

    expect(change.kind).toBe('SEVERITY_CHANGED');
    expect(change.baselineSeverity).toBe('ADVISORY');
    expect(change.subjectSeverity).toBe('CRITICAL');
  });

  it('reports how far a measurement moved without calling that a verdict', () => {
    const measurement = (value: number) => ({ label: 'peak', value, unit: 'm/s^2' });
    const baseline = findings([
      {
        ruleId: 'rule.vibration',
        severity: 'WARNING',
        startSeconds: 5,
        measurement: measurement(30),
      },
    ]);
    const subject = findings([
      {
        ruleId: 'rule.vibration',
        severity: 'WARNING',
        startSeconds: 5,
        measurement: measurement(45),
      },
    ]);

    const result = compareFindings(baseline, subject);
    const change = changeFor(result, 'rule.vibration');

    expect(change.measurementDeltas).toEqual([
      { label: 'peak', unit: 'm/s^2', baseline: 30, subject: 45, delta: 15 },
    ]);
    // The rule still says WARNING in both flights. Overriding its own judgement of materiality with
    // a threshold this package made up is exactly the invention doc 03 §4 exists to prevent.
    expect(change.kind).toBe('UNCHANGED');
    expect(result.verdict).toBe('SAME');
  });

  it('leaves out a measurement whose unit changed rather than differencing it', () => {
    // Subtracting metres per second squared from g produces a number that looks like a measurement
    // and is not one (doc 04 §1 rules 6 and 7). Converting here would be a unit assumption outside
    // core-domain, so the delta is simply not reported.
    const baseline = findings([
      {
        ruleId: 'rule.vibration',
        severity: 'WARNING',
        startSeconds: 5,
        measurement: { label: 'peak', value: 30, unit: 'm/s^2' },
      },
    ]);
    const subject = findings([
      {
        ruleId: 'rule.vibration',
        severity: 'WARNING',
        startSeconds: 5,
        measurement: { label: 'peak', value: 3, unit: 'g' },
      },
    ]);

    expect(
      changeFor(compareFindings(baseline, subject), 'rule.vibration').measurementDeltas,
    ).toEqual([]);
  });

  it('leaves out a measurement only one of the two findings reported', () => {
    const baseline = findings([
      {
        ruleId: 'rule.vibration',
        severity: 'WARNING',
        startSeconds: 5,
        measurement: { label: 'peak', value: 30, unit: 'm/s^2' },
      },
    ]);
    const subject = findings([{ ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 5 }]);

    expect(
      changeFor(compareFindings(baseline, subject), 'rule.vibration').measurementDeltas,
    ).toEqual([]);
  });

  it('matches repeated findings from one rule in time order', () => {
    const baseline = findings([
      { ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 5, ordinal: 0 },
      { ruleId: 'rule.vibration', severity: 'ADVISORY', startSeconds: 20, ordinal: 1 },
    ]);
    const subject = findings([
      { ruleId: 'rule.vibration', severity: 'ADVISORY', startSeconds: 20, ordinal: 1 },
      { ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 5, ordinal: 0 },
    ]);

    // Same two findings, handed over in the other order. Matching by arrival would report two
    // severity changes that did not happen.
    expect(compareFindings(baseline, subject).verdict).toBe('SAME');
  });

  it('reports an extra occurrence of a rule that already fired', () => {
    const baseline = findings([{ ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 5 }]);
    const subject = findings([
      { ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 5, ordinal: 0 },
      { ruleId: 'rule.vibration', severity: 'WARNING', startSeconds: 30, ordinal: 1 },
    ]);

    const result = compareFindings(baseline, subject);

    expect(result.changes.filter((change) => change.kind === 'NEW')).toHaveLength(1);
    expect(result.verdict).toBe('DIFFERENT');
  });

  it('says nothing changed when neither flight produced a finding', () => {
    const result = compareFindings([], []);

    expect(result.verdict).toBe('SAME');
    expect(result.changes).toEqual([]);
  });
});
