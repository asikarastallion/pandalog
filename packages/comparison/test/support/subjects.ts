/** Synthetic flights for comparison tests, built so two of them differ in exactly one way. */
import { createFinding, type EvidenceRef, type Finding, type Severity } from '@pandalog/analysis';
import { createCanonicalFlightDataset, createSignal, createTimeBase } from '@pandalog/core-domain';
import { createFlightEvent, type FlightEvent } from '@pandalog/events';
import {
  Validity,
  type CanonicalFlightDataset,
  type CanonicalUnit,
  type Sample,
  type Signal,
  type TimeOrigin,
} from '@pandalog/schema';
import {
  recordFail,
  recordInconclusive,
  recordNotApplicable,
  recordPass,
  type VerificationOutcome,
  type VerificationReport,
  type VerificationResult,
} from '@pandalog/verification';

import type { ComparisonSubject } from '@pandalog/comparison';

export const NOW = '2026-01-01T00:00:00.000Z';
export const now = (): Date => new Date(NOW);

const PROVENANCE = {
  fileName: 'synthetic.bin',
  sha256: 'a'.repeat(64),
  sizeBytes: 256,
  format: 'synthetic',
  parserPackage: '@pandalog/comparison-test',
  parserVersion: '0.1.0',
  ingestedAtUtc: NOW,
};

export interface SignalSpec {
  readonly id: string;
  readonly unit?: CanonicalUnit;
  /** Value at each sample time; return null for a sample the log did not carry. */
  readonly at: (tSeconds: number) => number | null;
  readonly sampleCount?: number;
  readonly periodSeconds?: number;
  readonly startSeconds?: number;
}

export function buildSignal(spec: SignalSpec, origin: TimeOrigin = 'BOOT'): Signal {
  const count = spec.sampleCount ?? 51;
  const period = spec.periodSeconds ?? 0.1;
  const start = spec.startSeconds ?? 0;

  const samples: Sample[] = Array.from({ length: count }, (_unused, index) => {
    const t = start + index * period;
    const value = spec.at(t);
    return value === null
      ? { t_rel_seconds: t, value: NaN, validity: Validity.MISSING }
      : { t_rel_seconds: t, value, validity: Validity.VALID };
  });

  return createSignal({
    id: spec.id,
    unit: spec.unit ?? 'm',
    sourceUnit: null,
    timeBase: createTimeBase({ origin }),
    samples,
  });
}

export interface DatasetSpec {
  readonly signals: readonly SignalSpec[];
  readonly origin?: TimeOrigin;
  readonly syncUncertaintySeconds?: number | null;
  readonly fileName?: string;
}

export function buildDataset(spec: DatasetSpec): CanonicalFlightDataset {
  const origin = spec.origin ?? 'BOOT';
  const timeBase = createTimeBase({
    origin,
    ...(origin === 'UTC_EPOCH' ? { epochUtc: NOW } : {}),
    syncUncertaintySeconds: spec.syncUncertaintySeconds ?? null,
  });

  return createCanonicalFlightDataset({
    provenance: { ...PROVENANCE, fileName: spec.fileName ?? PROVENANCE.fileName },
    vehicle: { frameClass: 'quad', firmwareVersion: null, firmwareHash: null },
    timeBase,
    signals: spec.signals.map((signal) => buildSignal(signal, origin)),
    sourceEvents: [],
  });
}

export interface EventSpec {
  readonly type: string;
  readonly startSeconds: number;
  readonly endSeconds?: number | null;
  readonly signalId?: string;
}

const DETECTOR = { name: 'test-detector', version: '1.0.0' };

export function buildEvent(spec: EventSpec, ordinal = 0): FlightEvent {
  return createFlightEvent({
    id: `${DETECTOR.name}:${spec.type}@${spec.startSeconds.toFixed(6)}#${String(ordinal)}`,
    type: spec.type,
    t_start_seconds: spec.startSeconds,
    t_end_seconds: spec.endSeconds ?? null,
    sourceSignalIds: [spec.signalId ?? 'sensor.a'],
    detector: DETECTOR,
  });
}

export interface FindingSpec {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly startSeconds: number;
  readonly endSeconds?: number;
  readonly measurement?: { readonly label: string; readonly value: number; readonly unit: string };
  readonly ordinal?: number;
}

export function buildFinding(spec: FindingSpec): Finding {
  const evidence: EvidenceRef[] = [
    {
      kind: 'signal-window',
      signalId: 'sensor.a',
      t_start_seconds: spec.startSeconds,
      t_end_seconds: spec.endSeconds ?? spec.startSeconds + 1,
    },
  ];

  return createFinding({
    id: `${spec.ruleId}@${spec.startSeconds.toFixed(6)}#${String(spec.ordinal ?? 0)}`,
    ruleId: spec.ruleId,
    ruleVersion: '1.0.0',
    statement: `${spec.ruleId} fired at ${String(spec.startSeconds)} s`,
    severity: spec.severity,
    evidence,
    measurements: spec.measurement === undefined ? [] : [spec.measurement],
    thresholds: [],
    producedAtUtc: NOW,
  });
}

const REQUIREMENT_EVIDENCE: EvidenceRef = {
  kind: 'signal-window',
  signalId: 'sensor.a',
  t_start_seconds: 0,
  t_end_seconds: 5,
};

function buildResult(
  id: string,
  outcome: VerificationOutcome,
  version = '1.0.0',
): VerificationResult {
  const requirement = { id, version };
  const reason = `${id} evaluated to ${outcome} in a synthetic flight.`;

  switch (outcome) {
    case 'PASS':
      return recordPass({
        requirement,
        reason,
        evidence: [REQUIREMENT_EVIDENCE],
        evaluatedAtUtc: NOW,
      });
    case 'FAIL':
      return recordFail({
        requirement,
        reason,
        evidence: [REQUIREMENT_EVIDENCE],
        evaluatedAtUtc: NOW,
      });
    case 'INCONCLUSIVE':
      return recordInconclusive({ requirement, reason, evaluatedAtUtc: NOW });
    case 'NOT_APPLICABLE':
      return recordNotApplicable({ requirement, reason, evaluatedAtUtc: NOW });
  }
}

export interface VerificationSpec {
  readonly outcomes: Readonly<Record<string, VerificationOutcome>>;
  readonly setId?: string;
  readonly setVersion?: string;
  readonly versions?: Readonly<Record<string, string>>;
}

export function buildVerification(spec: VerificationSpec): VerificationReport {
  const results = Object.entries(spec.outcomes)
    .map(([id, outcome]) => buildResult(id, outcome, spec.versions?.[id]))
    .sort((a, b) => a.requirementId.localeCompare(b.requirementId));

  const summary: Record<VerificationOutcome, number> = {
    PASS: 0,
    FAIL: 0,
    INCONCLUSIVE: 0,
    NOT_APPLICABLE: 0,
  };
  for (const result of results) {
    summary[result.outcome] += 1;
  }

  return Object.freeze({
    requirementSetId: spec.setId ?? 'test-set',
    requirementSetVersion: spec.setVersion ?? '1.0.0',
    requirementSetSource: 'provisional' as const,
    results: Object.freeze(results),
    summary: Object.freeze(summary),
    evidenceRuleViolations: Object.freeze([]),
  });
}

export interface SubjectSpec {
  readonly label: string;
  readonly dataset?: DatasetSpec;
  readonly events?: readonly EventSpec[];
  readonly findings?: readonly FindingSpec[];
  readonly verification?: VerificationSpec;
}

/** A flight that is flat and boring unless a test says otherwise. */
export const FLAT: DatasetSpec = {
  signals: [
    { id: 'sensor.a', at: (t) => Math.sin(t) },
    { id: 'sensor.b', unit: 'rad', at: () => 0.5 },
  ],
};

export function buildSubject(spec: SubjectSpec): ComparisonSubject {
  return {
    label: spec.label,
    dataset: buildDataset(spec.dataset ?? FLAT),
    events: (spec.events ?? []).map((event, index) => buildEvent(event, index)),
    findings: (spec.findings ?? []).map(buildFinding),
    verification: buildVerification(spec.verification ?? { outcomes: { 'REQ-A': 'PASS' } }),
  };
}
