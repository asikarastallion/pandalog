/**
 * Finding — 03_ANALYSIS_AND_VERIFICATION.md §2 and §3, 04 §1 rule 9.
 *
 * A Finding is a claim: "X exceeded criterion Y". It is the thing an engineer signs off on, which
 * is why `createFinding` is a validated operation rather than an object literal — doc 03 §3 states
 * outright that there must be *no* code path producing a Finding without at least one EvidenceRef,
 * and this module is that guarantee.
 *
 * A Finding also has no `confidence` field. Doc 03 §1: a Finding must not silently mean
 * "hypothesis". If a statement is not established by its evidence, it is a Hypothesis, and that is
 * a different type.
 */
import { validateEvidenceRef, type EvidenceRef } from './evidence.js';
import { AnalysisError } from './errors.js';

export type Severity = 'INFO' | 'ADVISORY' | 'WARNING' | 'CRITICAL';

const SEVERITIES: ReadonlySet<string> = new Set<Severity>([
  'INFO',
  'ADVISORY',
  'WARNING',
  'CRITICAL',
]);

/**
 * Where a numeric threshold came from — doc 03 §4.
 *
 * The template literal types make this checkable at compile time: a threshold cannot be introduced
 * without saying whether it is traceable to a document, derived from data, or simply not yet
 * justified. `provisional` is a legitimate answer; an unstated basis is not.
 */
export type ThresholdBasis = `spec:${string}` | `empirical:${string}` | 'provisional';

export interface Measurement {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}

export interface ThresholdRecord {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly basis: ThresholdBasis;
}

export interface Finding {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleVersion: string; // semver of the rule implementation, doc 03 §4
  readonly statement: string;
  readonly severity: Severity;
  /** MANDATORY. A Finding with an empty array is invalid and is rejected at construction. */
  readonly evidence: readonly EvidenceRef[];
  readonly measurements: readonly Measurement[];
  readonly thresholds: readonly ThresholdRecord[];
  readonly producedAtUtc: string;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BASIS_RE = /^(spec:.+|empirical:.+|provisional)$/;

/**
 * Whether a string states where a threshold came from (doc 03 §4).
 *
 * Exported because doc 03 §4 applies the identical contract to requirements in
 * `@pandalog/verification`; one predicate keeps the two from drifting apart.
 */
export function isThresholdBasis(basis: string): boolean {
  return BASIS_RE.test(basis);
}

export interface CreateFindingInput {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly statement: string;
  readonly severity: Severity;
  readonly evidence: readonly EvidenceRef[];
  readonly measurements?: readonly Measurement[];
  readonly thresholds?: readonly ThresholdRecord[];
  readonly producedAtUtc: string;
}

/**
 * Build a validated Finding.
 *
 * @throws {AnalysisError} MISSING_EVIDENCE when `evidence` is empty — the rule doc 03 §3 exists to
 * make unbreakable — or INVALID_FINDING for any other malformed field.
 */
export function createFinding(input: CreateFindingInput): Finding {
  if (input.evidence.length === 0) {
    throw new AnalysisError(
      'MISSING_EVIDENCE',
      `Rule ${input.ruleId} tried to produce a Finding with no evidence: ` +
        `${JSON.stringify(input.statement)}. A Finding is a claim an engineer signs off on, and a ` +
        'claim without evidence is an opinion (doc 03 §3). Attach at least one EvidenceRef, or ' +
        'produce a Hypothesis instead.',
      { ruleId: input.ruleId, statement: input.statement },
    );
  }

  const fail = (message: string): never => {
    throw new AnalysisError('INVALID_FINDING', message, {
      ruleId: input.ruleId,
      id: input.id,
    });
  };

  if (input.id.length === 0) {
    fail('A Finding needs a non-empty id.');
  }
  if (input.ruleId.length === 0) {
    fail('A Finding must name the rule that produced it.');
  }
  if (!SEMVER_RE.test(input.ruleVersion)) {
    fail(
      `Rule ${input.ruleId} declares version ${JSON.stringify(input.ruleVersion)}, which is not ` +
        'semver. A finding must be traceable to the exact rule logic that produced it (doc 03 §4).',
    );
  }
  if (input.statement.trim().length === 0) {
    fail('A Finding needs a statement describing what was found.');
  }
  if (!SEVERITIES.has(input.severity)) {
    fail(`Unknown severity ${JSON.stringify(input.severity)}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(input.producedAtUtc)) {
    fail(
      `producedAtUtc must be an ISO-8601 UTC instant, got ${JSON.stringify(input.producedAtUtc)}.`,
    );
  }

  for (const measurement of input.measurements ?? []) {
    if (measurement.label.length === 0 || measurement.unit.length === 0) {
      fail('Every measurement needs a label and a unit.');
    }
    if (!Number.isFinite(measurement.value)) {
      fail(`Measurement ${measurement.label} must be a finite number.`);
    }
  }

  for (const threshold of input.thresholds ?? []) {
    if (threshold.label.length === 0 || threshold.unit.length === 0) {
      fail('Every threshold needs a label and a unit.');
    }
    if (!Number.isFinite(threshold.value)) {
      fail(`Threshold ${threshold.label} must be a finite number.`);
    }
    if (!isThresholdBasis(threshold.basis)) {
      fail(
        `Threshold ${threshold.label} declares basis ${JSON.stringify(threshold.basis)}. It must be ` +
          'spec:<document/section>, empirical:<dataset/method>, or provisional (doc 03 §4). An ' +
          'unjustified number may be shipped, but it must say that it is unjustified.',
      );
    }
  }

  return Object.freeze({
    id: input.id,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    statement: input.statement,
    severity: input.severity,
    evidence: Object.freeze(input.evidence.map(validateEvidenceRef)),
    measurements: Object.freeze((input.measurements ?? []).map((m) => Object.freeze({ ...m }))),
    thresholds: Object.freeze((input.thresholds ?? []).map((t) => Object.freeze({ ...t }))),
    producedAtUtc: input.producedAtUtc,
  });
}

/** Deterministic finding id, so evidence references stay stable across runs (doc 03 §6). */
export function findingId(ruleId: string, startSeconds: number, ordinal: number): string {
  return `${ruleId}@${startSeconds.toFixed(6)}#${String(ordinal)}`;
}
