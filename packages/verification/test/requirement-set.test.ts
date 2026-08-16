/**
 * Requirement set construction — doc 03 §4, doc 05 Phase F.
 *
 * Doc 03 §4 applies the same documentation contract to a requirement as to an analysis rule:
 * inputs, formula, units, thresholds with a declared basis, assumptions, evidence. Here that is
 * enforced by the set constructor rather than by a test, so an undocumented requirement cannot be
 * registered at all — including by a consumer assembling their own set from their own test plan.
 */
import { describe, expect, it } from 'vitest';

import {
  createRequirementSet,
  PROVISIONAL_REQUIREMENT_SET_V1,
  recordInconclusive,
  VerificationError,
  type RequirementDefinition,
  type RequirementDocumentation,
} from '@pandalog/verification';

import { NOW } from './support/context.js';

const documentation: RequirementDocumentation = {
  applicability: 'Applies to every flight.',
  inputs: ['attitude.roll'],
  formula: 'Always inconclusive.',
  units: 'Radians.',
  thresholds: [{ label: 'criterion', value: 1, unit: 'rad', basis: 'provisional' }],
  assumptions: ['A test double.'],
  evidence: 'None.',
};

const requirement = (overrides: Partial<RequirementDefinition> = {}): RequirementDefinition => ({
  id: 'REQ-X-001',
  version: '1.0.0',
  statement: 'Something shall hold.',
  documentation,
  appliesWhen: () => true,
  evaluate: () =>
    recordInconclusive({
      requirement: { id: 'REQ-X-001', version: '1.0.0' },
      reason: 'test double',
      evaluatedAtUtc: NOW,
    }),
  ...overrides,
});

const setOf = (requirements: readonly RequirementDefinition[], patch = {}) =>
  createRequirementSet({
    id: 'test-set',
    version: '1.0.0',
    source: 'provisional' as const,
    description: 'A set of test doubles.',
    requirements,
    ...patch,
  });

describe('createRequirementSet', () => {
  it('accepts a well-formed set and freezes it', () => {
    const set = setOf([requirement()]);

    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.requirements)).toBe(true);
  });

  it.each([
    ['spec:', 'spec:AC-TEST-PLAN-2026 §4.2'],
    ['test-plan:', 'test-plan:acme-quad-acceptance-v3'],
    ['provisional', 'provisional'],
  ] as const)('accepts a %s provenance', (_label, source) => {
    expect(() => setOf([requirement()], { source })).not.toThrow();
  });

  it('rejects a set that will not say where its requirements came from', () => {
    expect(() => setOf([requirement()], { source: 'from my head' })).toThrow(VerificationError);
  });

  it('rejects duplicate requirement ids — a result must name one requirement', () => {
    expect(() => setOf([requirement(), requirement()])).toThrow(VerificationError);
  });

  it('rejects an empty set — nothing to verify is not a verification', () => {
    expect(() => setOf([])).toThrow(VerificationError);
  });

  it.each([
    ['a non-semver set version', { version: '1' }],
    ['an empty set id', { id: '' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => setOf([requirement()], patch)).toThrow(VerificationError);
  });

  it.each([
    ['a non-semver requirement version', { version: 'latest' }],
    ['an empty requirement id', { id: '' }],
    ['a blank statement', { statement: '  ' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => setOf([requirement(patch)])).toThrow(VerificationError);
  });
});

describe('the documentation contract (doc 03 §4)', () => {
  it.each([
    ['applicability', { applicability: '' }],
    ['inputs', { inputs: [] }],
    ['formula', { formula: '  ' }],
    ['units', { units: '' }],
    ['assumptions', { assumptions: [] }],
    ['evidence', { evidence: '' }],
  ])('rejects a requirement with no %s', (_label, patch) => {
    expect(() => setOf([requirement({ documentation: { ...documentation, ...patch } })])).toThrow(
      VerificationError,
    );
  });

  it('rejects a threshold whose basis is not spec:, empirical: or provisional', () => {
    expect(() =>
      setOf([
        requirement({
          documentation: {
            ...documentation,
            thresholds: [{ label: 'c', value: 1, unit: 'rad', basis: 'because' as 'provisional' }],
          },
        }),
      ]),
    ).toThrow(VerificationError);
  });

  it('allows a requirement with no thresholds at all — not every one needs a number', () => {
    expect(() =>
      setOf([requirement({ documentation: { ...documentation, thresholds: [] } })]),
    ).not.toThrow();
  });
});

describe('the shipped requirement set', () => {
  const set = PROVISIONAL_REQUIREMENT_SET_V1;

  it('declares itself provisional, because nothing here traces to a real test plan', () => {
    expect(set.source).toBe('provisional');
  });

  it('is versioned, so a result can be traced to the requirement logic that produced it', () => {
    expect(set.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('documents every requirement — enforced by the constructor it was built with', () => {
    for (const item of set.requirements) {
      expect(item.documentation.formula.trim().length).toBeGreaterThan(0);
      expect(item.documentation.assumptions.length).toBeGreaterThan(0);
      expect(item.documentation.applicability.trim().length).toBeGreaterThan(0);
    }
  });

  it('says in every requirement statement that it is provisional', () => {
    for (const item of set.requirements) {
      expect(item.statement.toLowerCase()).toContain('provisional');
    }
  });

  it('has unique, stable requirement ids', () => {
    const ids = set.requirements.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });
});
