/**
 * Finding and Hypothesis construction — 03_ANALYSIS_AND_VERIFICATION.md §1-§3, doc 04 §1 rule 9.
 *
 * Phase E acceptance: "No code path can construct a Finding with empty evidence."
 */
import { describe, expect, it } from 'vitest';

import {
  AnalysisError,
  createFinding,
  createHypothesis,
  findingId,
  validateEvidenceRef,
  type CreateFindingInput,
  type EvidenceRef,
} from '@pandalog/analysis';

const window: EvidenceRef = {
  kind: 'signal-window',
  signalId: 'attitude.roll',
  t_start_seconds: 1,
  t_end_seconds: 2,
};

const base: CreateFindingInput = {
  id: 'f1',
  ruleId: 'analysis:test',
  ruleVersion: '1.0.0',
  statement: 'Roll tracking exceeded the configured criterion',
  severity: 'WARNING',
  evidence: [window],
  producedAtUtc: '2026-01-01T00:00:00.000Z',
};

describe('the mandatory-evidence rule (doc 03 §3)', () => {
  it('rejects a Finding with no evidence', () => {
    expect(() => createFinding({ ...base, evidence: [] })).toThrow(AnalysisError);
  });

  it('reports MISSING_EVIDENCE, distinct from other malformed input', () => {
    try {
      createFinding({ ...base, evidence: [] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AnalysisError).code).toBe('MISSING_EVIDENCE');
    }
  });

  it('names the rule and statement, so the offending code path is findable', () => {
    try {
      createFinding({ ...base, evidence: [] });
      expect.unreachable('should have thrown');
    } catch (error) {
      const analysisError = error as AnalysisError;
      expect(analysisError.context.ruleId).toBe('analysis:test');
      expect(analysisError.message).toContain('Hypothesis');
    }
  });

  it('accepts a single evidence reference — one is the minimum, not three', () => {
    expect(createFinding(base).evidence).toHaveLength(1);
  });

  it('freezes the evidence array so it cannot be emptied afterwards', () => {
    expect(Object.isFrozen(createFinding(base).evidence)).toBe(true);
  });
});

describe('createFinding', () => {
  it('produces a frozen finding with the doc 03 §2 fields', () => {
    const finding = createFinding(base);

    expect(Object.isFrozen(finding)).toBe(true);
    expect(finding.ruleId).toBe('analysis:test');
    expect(finding.severity).toBe('WARNING');
  });

  it('has no confidence field — a Finding must not mean "hypothesis" (doc 03 §1)', () => {
    expect(createFinding(base)).not.toHaveProperty('confidence');
  });

  describe('rejects malformed findings', () => {
    it.each([
      ['an empty id', { id: '' }],
      ['no rule id', { ruleId: '' }],
      ['a non-semver rule version', { ruleVersion: 'latest' }],
      ['a blank statement', { statement: '   ' }],
      ['an unknown severity', { severity: 'CATASTROPHIC' as 'WARNING' }],
      ['a non-ISO timestamp', { producedAtUtc: 'yesterday' }],
    ])('rejects %s', (_label, patch) => {
      expect(() => createFinding({ ...base, ...patch })).toThrow(AnalysisError);
    });

    it('rejects a measurement with a non-finite value', () => {
      expect(() =>
        createFinding({ ...base, measurements: [{ label: 'x', value: NaN, unit: 'rad' }] }),
      ).toThrow(AnalysisError);
    });

    it('rejects a measurement with no unit', () => {
      expect(() =>
        createFinding({ ...base, measurements: [{ label: 'x', value: 1, unit: '' }] }),
      ).toThrow(AnalysisError);
    });
  });

  describe('threshold basis (doc 03 §4)', () => {
    it.each([
      ['spec:', 'spec:doc-03-section-1' as const],
      ['empirical:', 'empirical:baseline-fleet-2026' as const],
      ['provisional', 'provisional' as const],
    ])('accepts a %s basis', (_label, basis) => {
      expect(() =>
        createFinding({
          ...base,
          thresholds: [{ label: 'criterion', value: 5, unit: 'rad', basis }],
        }),
      ).not.toThrow();
    });

    it('rejects a threshold whose basis is not one of the three forms', () => {
      expect(() =>
        createFinding({
          ...base,
          thresholds: [
            { label: 'criterion', value: 5, unit: 'rad', basis: 'because' as 'provisional' },
          ],
        }),
      ).toThrow(AnalysisError);
    });

    it('rejects a threshold with a non-finite value', () => {
      expect(() =>
        createFinding({
          ...base,
          thresholds: [{ label: 'c', value: Infinity, unit: 'rad', basis: 'provisional' }],
        }),
      ).toThrow(AnalysisError);
    });
  });
});

describe('evidence validation', () => {
  it('accepts each of the three kinds', () => {
    expect(() => validateEvidenceRef(window)).not.toThrow();
    expect(() => validateEvidenceRef({ kind: 'event', eventId: 'e1' })).not.toThrow();
    expect(() =>
      validateEvidenceRef({
        kind: 'measurement',
        signalId: 's',
        t_seconds: 1,
        value: 2,
        unit: 'rad',
      }),
    ).not.toThrow();
  });

  it('rejects a measurement citing NaN — an absence proves nothing', () => {
    expect(() =>
      validateEvidenceRef({
        kind: 'measurement',
        signalId: 's',
        t_seconds: 1,
        value: NaN,
        unit: 'rad',
      }),
    ).toThrow(AnalysisError);
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => validateEvidenceRef({ ...window, t_start_seconds: 5, t_end_seconds: 1 })).toThrow(
      AnalysisError,
    );
  });

  it('rejects an event reference with no id', () => {
    expect(() => validateEvidenceRef({ kind: 'event', eventId: '' })).toThrow(AnalysisError);
  });

  it('rejects a measurement with no unit', () => {
    expect(() =>
      validateEvidenceRef({ kind: 'measurement', signalId: 's', t_seconds: 1, value: 1, unit: '' }),
    ).toThrow(AnalysisError);
  });
});

describe('findingId', () => {
  it('is deterministic', () => {
    expect(findingId('r', 1.5, 0)).toBe(findingId('r', 1.5, 0));
  });

  it('distinguishes findings from one rule at one instant', () => {
    expect(findingId('r', 1.5, 0)).not.toBe(findingId('r', 1.5, 1));
  });
});

describe('Hypothesis is structurally distinct from Finding (doc 03 §1)', () => {
  const hypothesis = createHypothesis({
    id: 'h1',
    relatedFindingIds: ['f1'],
    statement: 'Possible actuator saturation contributed',
  });

  it('is always UNCONFIRMED', () => {
    expect(hypothesis.status).toBe('UNCONFIRMED');
  });

  it('carries no severity, so it cannot pose as an established result', () => {
    expect(hypothesis).not.toHaveProperty('severity');
  });

  it('carries no verification status, so nothing can read a pass/fail from it', () => {
    expect(hypothesis).not.toHaveProperty('verificationStatus');
  });

  it('may cite no evidence — being unestablished is the point', () => {
    expect(hypothesis.supportingEvidence).toEqual([]);
  });

  it('must name the findings it tries to explain', () => {
    expect(() =>
      createHypothesis({ id: 'h', relatedFindingIds: [], statement: 'something happened' }),
    ).toThrow(AnalysisError);
  });

  it('rejects a blank statement', () => {
    expect(() => createHypothesis({ id: 'h', relatedFindingIds: ['f1'], statement: '  ' })).toThrow(
      AnalysisError,
    );
  });

  it('validates any supporting evidence it does cite', () => {
    expect(() =>
      createHypothesis({
        id: 'h',
        relatedFindingIds: ['f1'],
        statement: 's',
        supportingEvidence: [{ kind: 'event', eventId: '' }],
      }),
    ).toThrow(AnalysisError);
  });
});
