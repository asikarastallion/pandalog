/**
 * VerificationResult construction and the evidence rule — doc 03 §2, §3.
 *
 * Phase F acceptance: "Missing evidence always yields INCONCLUSIVE, verified by a test that
 * withholds evidence and asserts the outcome is never PASS."
 */
import { describe, expect, it } from 'vitest';

import type { EvidenceRef } from '@pandalog/analysis';
import {
  asNonEmptyEvidence,
  claimsWithoutEvidence,
  enforceEvidenceRule,
  recordFail,
  recordInconclusive,
  recordNotApplicable,
  recordPass,
  VerificationError,
  type VerificationResult,
} from '@pandalog/verification';

const requirement = { id: 'REQ-TEST-001', version: '1.0.0' };
const evaluatedAtUtc = '2026-01-01T00:00:00.000Z';

const window: EvidenceRef = {
  kind: 'signal-window',
  signalId: 'attitude.roll',
  t_start_seconds: 0,
  t_end_seconds: 10,
};

const evidence = [window] as const;

/** A result built as a plain literal, the way a third-party requirement could return one. */
const literal = (patch: Partial<VerificationResult>): VerificationResult => ({
  requirementId: requirement.id,
  requirementVersion: requirement.version,
  outcome: 'PASS',
  evidence: [],
  reason: 'everything looked fine',
  evaluatedAtUtc,
  ...patch,
});

describe('the evidence rule (doc 03 §3)', () => {
  it.each([['PASS'], ['FAIL']] as const)(
    'records a %s with no evidence as INCONCLUSIVE',
    (outcome) => {
      expect(enforceEvidenceRule(literal({ outcome, evidence: [] })).outcome).toBe('INCONCLUSIVE');
    },
  );

  it('preserves the original reason so the downgrade is auditable', () => {
    const result = enforceEvidenceRule(literal({ outcome: 'PASS', evidence: [] }));

    expect(result.reason).toContain('everything looked fine');
    expect(result.reason).toContain('PASS');
    expect(result.reason).toContain('evidence');
  });

  it('leaves a PASS that cites evidence alone', () => {
    const result = literal({ outcome: 'PASS', evidence: [window] });

    expect(enforceEvidenceRule(result)).toBe(result);
  });

  it.each([['INCONCLUSIVE'], ['NOT_APPLICABLE']] as const)(
    'leaves %s with no evidence alone — those outcomes make no claim',
    (outcome) => {
      const result = literal({ outcome, evidence: [] });

      expect(enforceEvidenceRule(result)).toBe(result);
    },
  );

  it('identifies an unevidenced claim without changing it', () => {
    expect(claimsWithoutEvidence(literal({ outcome: 'PASS', evidence: [] }))).toBe(true);
    expect(claimsWithoutEvidence(literal({ outcome: 'FAIL', evidence: [] }))).toBe(true);
    expect(claimsWithoutEvidence(literal({ outcome: 'PASS', evidence: [window] }))).toBe(false);
    expect(claimsWithoutEvidence(literal({ outcome: 'INCONCLUSIVE', evidence: [] }))).toBe(false);
  });
});

describe('asNonEmptyEvidence', () => {
  it('returns null for an empty array, so the caller must choose another outcome', () => {
    expect(asNonEmptyEvidence([])).toBeNull();
  });

  it('returns the evidence when there is some', () => {
    expect(asNonEmptyEvidence([window])).toEqual([window]);
  });
});

describe('recordPass / recordFail', () => {
  it('produce the claimed outcome when evidence is cited', () => {
    expect(recordPass({ requirement, evidence, reason: 'r', evaluatedAtUtc }).outcome).toBe('PASS');
    expect(recordFail({ requirement, evidence, reason: 'r', evaluatedAtUtc }).outcome).toBe('FAIL');
  });

  it('freeze the result and its evidence', () => {
    const result = recordPass({ requirement, evidence, reason: 'r', evaluatedAtUtc });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it('never yield PASS when the evidence array is emptied behind the type', () => {
    const emptied = [] as unknown as readonly [EvidenceRef, ...EvidenceRef[]];

    expect(
      recordPass({ requirement, evidence: emptied, reason: 'r', evaluatedAtUtc }).outcome,
    ).toBe('INCONCLUSIVE');
  });

  it('validate the evidence they are given', () => {
    const bad = [{ kind: 'event', eventId: '' }] as unknown as readonly [
      EvidenceRef,
      ...EvidenceRef[],
    ];

    expect(() => recordPass({ requirement, evidence: bad, reason: 'r', evaluatedAtUtc })).toThrow(
      VerificationError,
    );
  });
});

describe('recordInconclusive / recordNotApplicable', () => {
  it('need no evidence', () => {
    expect(
      recordInconclusive({ requirement, reason: 'no usable data', evaluatedAtUtc }).outcome,
    ).toBe('INCONCLUSIVE');
    expect(
      recordNotApplicable({ requirement, reason: 'no GPS logged', evaluatedAtUtc }).outcome,
    ).toBe('NOT_APPLICABLE');
  });

  it('may still cite what was examined', () => {
    const result = recordInconclusive({
      requirement,
      reason: 'partial data',
      evidence: [window],
      evaluatedAtUtc,
    });

    expect(result.evidence).toHaveLength(1);
  });
});

describe('result validation', () => {
  it.each([
    ['an empty requirement id', { requirement: { id: '', version: '1.0.0' } }],
    ['a non-semver requirement version', { requirement: { id: 'R', version: 'latest' } }],
    ['a blank reason', { reason: '   ' }],
    ['a non-ISO timestamp', { evaluatedAtUtc: 'yesterday' }],
  ])('rejects %s', (_label, patch) => {
    expect(() =>
      recordPass({ requirement, evidence, reason: 'r', evaluatedAtUtc, ...patch }),
    ).toThrow(VerificationError);
  });

  it('reports INVALID_RESULT so the failure is distinguishable', () => {
    try {
      recordPass({ requirement, evidence, reason: '  ', evaluatedAtUtc });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as VerificationError).code).toBe('INVALID_RESULT');
    }
  });
});
