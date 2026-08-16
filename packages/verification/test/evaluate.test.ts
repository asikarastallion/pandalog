/**
 * The requirement evaluator — doc 03 §2, §3, §6 and doc 05 Phase F.
 *
 * The harness is the last line of defence. `RequirementDefinition` is an interface, so a
 * requirement can return any object it likes — including one claiming PASS with nothing behind it.
 * These tests exercise that: a requirement that lies, and a requirement that crashes, must both end
 * up as INCONCLUSIVE rather than taking down the run or slipping through as a pass.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createRequirementSet,
  recordInconclusive,
  recordPass,
  verifyRequirements,
  type RequirementContext,
  type RequirementDefinition,
  type VerificationResult,
} from '@pandalog/verification';

import { contextOf, NOW } from './support/context.js';

const documentation = {
  applicability: 'Applies to every flight in the test suite.',
  inputs: ['attitude.roll'],
  formula: 'Always the same answer.',
  units: 'None.',
  thresholds: [],
  assumptions: ['This is a test double, not a real requirement.'],
  evidence: 'A single fabricated signal window.',
};

const evidence = [
  {
    kind: 'signal-window' as const,
    signalId: 'attitude.roll',
    t_start_seconds: 0,
    t_end_seconds: 1,
  },
] as const;

function stub(id: string, overrides: Partial<RequirementDefinition> = {}): RequirementDefinition {
  return {
    id,
    version: '1.0.0',
    statement: `${id} shall hold.`,
    documentation,
    appliesWhen: () => true,
    evaluate: (context: RequirementContext) =>
      recordPass({
        requirement: { id, version: '1.0.0' },
        evidence,
        reason: 'nothing was wrong',
        evaluatedAtUtc: context.now().toISOString(),
      }),
    ...overrides,
  };
}

const setOf = (requirements: readonly RequirementDefinition[]) =>
  createRequirementSet({
    id: 'test-set',
    version: '1.0.0',
    source: 'provisional',
    description: 'A set of test doubles.',
    requirements,
  });

const outcomesOf = (results: readonly VerificationResult[]) => results.map((r) => r.outcome);

describe('applicability (doc 05 Phase F)', () => {
  it('produces NOT_APPLICABLE rather than forcing a PASS or FAIL', () => {
    const report = verifyRequirements(
      setOf([stub('REQ-A', { appliesWhen: () => false })]),
      contextOf({}),
    );

    expect(outcomesOf(report.results)).toEqual(['NOT_APPLICABLE']);
  });

  it('explains why, using the requirement’s own applicability statement', () => {
    const report = verifyRequirements(
      setOf([stub('REQ-A', { appliesWhen: () => false })]),
      contextOf({}),
    );

    expect(report.results.map((r) => r.reason).join()).toContain(documentation.applicability);
  });

  it('does not evaluate a requirement that does not apply', () => {
    const evaluate = vi.fn();
    verifyRequirements(
      setOf([stub('REQ-A', { appliesWhen: () => false, evaluate })]),
      contextOf({}),
    );

    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('a requirement that claims more than it can show', () => {
  const liar = stub('REQ-LIAR', {
    evaluate: () => ({
      requirementId: 'REQ-LIAR',
      requirementVersion: '1.0.0',
      outcome: 'PASS' as const,
      evidence: [],
      reason: 'looked fine to me',
      evaluatedAtUtc: NOW,
    }),
  });

  it('is recorded INCONCLUSIVE, never PASS', () => {
    const report = verifyRequirements(setOf([liar]), contextOf({}));

    expect(outcomesOf(report.results)).toEqual(['INCONCLUSIVE']);
  });

  it('is listed as an evidence-rule violation, because it is a bug worth seeing', () => {
    const report = verifyRequirements(setOf([liar]), contextOf({}));

    expect(report.evidenceRuleViolations).toEqual(['REQ-LIAR']);
  });

  it('leaves honest requirements untouched', () => {
    const report = verifyRequirements(setOf([liar, stub('REQ-OK')]), contextOf({}));

    expect(outcomesOf(report.results)).toEqual(['INCONCLUSIVE', 'PASS']);
    expect(report.evidenceRuleViolations).toEqual(['REQ-LIAR']);
  });
});

describe('a requirement that throws', () => {
  const thrower = stub('REQ-BOOM', {
    evaluate: () => {
      throw new Error('divide by zero');
    },
  });

  it('does not take down the verification run', () => {
    expect(() => verifyRequirements(setOf([thrower, stub('REQ-OK')]), contextOf({}))).not.toThrow();
  });

  it('is recorded INCONCLUSIVE with the failure named', () => {
    const report = verifyRequirements(setOf([thrower]), contextOf({}));

    expect(outcomesOf(report.results)).toEqual(['INCONCLUSIVE']);
    expect(report.results.map((r) => r.reason).join()).toContain('divide by zero');
  });

  it('is never mistaken for a PASS', () => {
    const report = verifyRequirements(setOf([thrower]), contextOf({}));

    expect(report.results.every((r) => r.outcome !== 'PASS')).toBe(true);
  });
});

describe('a requirement that answers about a different requirement', () => {
  it('is rejected — a result must identify its own requirement', () => {
    const impostor = stub('REQ-SELF', {
      evaluate: () =>
        recordPass({
          requirement: { id: 'REQ-OTHER', version: '1.0.0' },
          evidence,
          reason: 'not my id',
          evaluatedAtUtc: NOW,
        }),
    });

    const report = verifyRequirements(setOf([impostor]), contextOf({}));

    expect(outcomesOf(report.results)).toEqual(['INCONCLUSIVE']);
    expect(report.results.map((r) => r.reason).join()).toContain('REQ-OTHER');
  });
});

describe('the report', () => {
  const set = setOf([
    stub('REQ-C'),
    stub('REQ-A', { appliesWhen: () => false }),
    stub('REQ-B', {
      evaluate: (context: RequirementContext) =>
        recordInconclusive({
          requirement: { id: 'REQ-B', version: '1.0.0' },
          reason: 'not enough data',
          evaluatedAtUtc: context.now().toISOString(),
        }),
    }),
  ]);

  it('orders results by requirement id, not registration order (doc 03 §6)', () => {
    const report = verifyRequirements(set, contextOf({}));

    expect(report.results.map((r) => r.requirementId)).toEqual(['REQ-A', 'REQ-B', 'REQ-C']);
  });

  it('counts every outcome, including the ones that are zero', () => {
    const report = verifyRequirements(set, contextOf({}));

    expect(report.summary).toEqual({
      PASS: 1,
      FAIL: 0,
      INCONCLUSIVE: 1,
      NOT_APPLICABLE: 1,
    });
  });

  it('records which requirement set produced it', () => {
    const report = verifyRequirements(set, contextOf({}));

    expect(report.requirementSetId).toBe('test-set');
    expect(report.requirementSetVersion).toBe('1.0.0');
    expect(report.requirementSetSource).toBe('provisional');
  });

  it('is byte-identical across repeated runs on one context (doc 03 §6)', () => {
    const context = contextOf({});

    expect(JSON.stringify(verifyRequirements(set, context))).toBe(
      JSON.stringify(verifyRequirements(set, context)),
    );
  });
});
