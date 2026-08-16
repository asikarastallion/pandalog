/**
 * Requirements answered by whether the analysis layer raised a finding.
 *
 * These three requirements share one shape, which is worth naming because it is the shape that
 * makes a PASS mean something:
 *
 *   1. Decide whether the flight logged the signals the requirement is about. If not,
 *      NOT_APPLICABLE — a rover that logs no attitude target has not failed an attitude
 *      requirement, and doc 05 Phase F forbids forcing it into a PASS or FAIL.
 *   2. Establish *what was examined*: the interval over each signal that actually carried usable
 *      samples. A signal that is present but entirely MISSING was not examined, and if nothing was
 *      examined the outcome is INCONCLUSIVE. This is doc 03 §3's rule in its most important form —
 *      not "we found no problem", but "we had nothing to look at".
 *   3. Only then, ask whether the analysis layer raised a finding over that data.
 *
 * The examined interval is the evidence for a PASS. A PASS that cited nothing would be an
 * assertion, and this package exists to stop those.
 */
import type { EvidenceRef, Finding } from '@pandalog/analysis';
import { isValueBearing, type Signal } from '@pandalog/schema';

import type {
  RequirementContext,
  RequirementDefinition,
  RequirementDocumentation,
} from '../requirement.js';
import {
  asNonEmptyEvidence,
  recordFail,
  recordInconclusive,
  recordPass,
  type VerificationResult,
} from '../result.js';

const REQUIREMENT_VERSION = '1.0.0';

/** The interval a signal actually carried usable samples over, or null if it carried none. */
function examinedSpan(signal: Signal): { start: number; end: number } | null {
  const samples = signal.samples;
  let start: number | null = null;
  let end: number | null = null;

  for (const sample of samples) {
    if (!isValueBearing(sample.validity)) {
      continue;
    }
    start ??= sample.t_rel_seconds;
    end = sample.t_rel_seconds;
  }

  return start === null || end === null ? null : { start, end };
}

interface AnalysisBackedSpec {
  readonly id: string;
  readonly statement: string;
  readonly documentation: RequirementDocumentation;
  /**
   * Signal groups the requirement can work from. The requirement applies when at least one group is
   * present in full — so an aircraft logging roll but not pitch is still checked on roll.
   */
  readonly signalGroups: readonly (readonly string[])[];
  /** The analysis rule whose findings decide this requirement. */
  readonly ruleId: string;
  /** Short noun phrase naming what is being verified, used in the reason text. */
  readonly subject: string;
}

const presentGroups = (spec: AnalysisBackedSpec, context: RequirementContext) =>
  spec.signalGroups.filter((group) => group.every((id) => context.dataset.signals.has(id)));

interface Examined {
  readonly evidence: EvidenceRef[];
  readonly signalIds: string[];
  /** Outer bounds of everything examined, for the human-readable reason. Null if nothing was. */
  readonly span: { start: number; end: number } | null;
}

function examinedEvidence(spec: AnalysisBackedSpec, context: RequirementContext): Examined {
  const evidence: EvidenceRef[] = [];
  const signalIds: string[] = [];
  let span: { start: number; end: number } | null = null;

  for (const group of presentGroups(spec, context)) {
    for (const id of group) {
      signalIds.push(id);

      const signal = context.dataset.signals.get(id);
      const signalSpan = signal === undefined ? null : examinedSpan(signal);
      if (signalSpan === null) {
        continue;
      }

      evidence.push({
        kind: 'signal-window',
        signalId: id,
        t_start_seconds: signalSpan.start,
        t_end_seconds: signalSpan.end,
      });
      span =
        span === null
          ? signalSpan
          : {
              start: Math.min(span.start, signalSpan.start),
              end: Math.max(span.end, signalSpan.end),
            };
    }
  }

  return { evidence, signalIds, span };
}

const findingsFrom = (context: RequirementContext, ruleId: string): Finding[] =>
  context.findings.filter((finding) => finding.ruleId === ruleId);

function evaluateAnalysisBacked(
  spec: AnalysisBackedSpec,
  context: RequirementContext,
): VerificationResult {
  const requirement = { id: spec.id, version: REQUIREMENT_VERSION };
  const evaluatedAtUtc = context.now().toISOString();
  const { evidence, signalIds, span } = examinedEvidence(spec, context);

  const examined = asNonEmptyEvidence(evidence);
  if (examined === null || span === null) {
    return recordInconclusive({
      requirement,
      reason:
        `No usable ${spec.subject} data was examined: ${signalIds.join(', ')} carried no samples ` +
        'marked VALID or INTERPOLATED. Nothing was measured, so nothing is verified — this is not ' +
        'a pass.',
      evaluatedAtUtc,
    });
  }

  const findings = findingsFrom(context, spec.ruleId);
  const window = `t=[${span.start.toFixed(3)}, ${span.end.toFixed(3)}]`;

  if (findings.length > 0) {
    return recordFail({
      requirement,
      evidence: [...examined, ...findings.flatMap((finding) => finding.evidence)] as [
        EvidenceRef,
        ...EvidenceRef[],
      ],
      reason:
        `${String(findings.length)} finding(s) from ${spec.ruleId} exceeded its criterion over ` +
        `${window}. The criterion is provisional and is not traceable to a flight-test document, ` +
        'so this FAIL states that a provisional criterion was exceeded — not that the aircraft ' +
        'breached a qualified limit.',
      evaluatedAtUtc,
    });
  }

  return recordPass({
    requirement,
    evidence: examined,
    reason:
      `${spec.ruleId} raised no finding over the ${String(examined.length)} signal window(s) ` +
      `examined (${window}). The criterion is provisional and is not traceable to a flight-test ` +
      'document, so this PASS means the flight met a provisional criterion, not a qualified one.',
    evaluatedAtUtc,
  });
}

function analysisBackedRequirement(spec: AnalysisBackedSpec): RequirementDefinition {
  return {
    id: spec.id,
    version: REQUIREMENT_VERSION,
    statement: spec.statement,
    documentation: spec.documentation,
    appliesWhen: (context: RequirementContext) => presentGroups(spec, context).length > 0,
    evaluate: (context: RequirementContext) => evaluateAnalysisBacked(spec, context),
  };
}

// ---------------------------------------------------------------------------------------------
// REQ-ATT-001 — attitude tracking
// ---------------------------------------------------------------------------------------------

export const ATTITUDE_TRACKING_REQUIREMENT: RequirementDefinition = analysisBackedRequirement({
  id: 'REQ-ATT-001',
  statement:
    'Attitude tracking error shall remain within the provisional RMS criterion for the whole ' +
    'flight.',
  ruleId: 'analysis:attitude-tracking-error',
  subject: 'attitude',
  signalGroups: [
    ['attitude.roll', 'attitude.roll.desired'],
    ['attitude.pitch', 'attitude.pitch.desired'],
  ],
  documentation: {
    applicability:
      'Applies to any flight logging both a commanded and a measured attitude on at least one of ' +
      'roll or pitch. A vehicle that logs no attitude target has nothing to track against.',
    inputs: [
      'finding:analysis:attitude-tracking-error',
      'attitude.roll',
      'attitude.roll.desired',
      'attitude.pitch',
      'attitude.pitch.desired',
    ],
    formula:
      'Take the interval each attitude signal carried value-bearing samples over. If no signal ' +
      'carried any, INCONCLUSIVE. Otherwise FAIL when analysis:attitude-tracking-error produced ' +
      'any finding, PASS when it produced none.',
    units: 'Angles in canonical radians; time in seconds on the dataset time base.',
    thresholds: [],
    assumptions: [
      'The RMS criterion itself lives in analysis:attitude-tracking-error and is provisional; ' +
        'this requirement inherits that limitation and says so in its result.',
      'A signal that is present but entirely MISSING counts as not examined, not as compliant.',
    ],
    evidence:
      'A signal-window per examined attitude signal bounding the interval that carried usable ' +
      'samples, plus every EvidenceRef of each contributing finding when the outcome is FAIL.',
  },
});

// ---------------------------------------------------------------------------------------------
// REQ-GNSS-001 — GNSS availability
// ---------------------------------------------------------------------------------------------

export const GNSS_AVAILABILITY_REQUIREMENT: RequirementDefinition = analysisBackedRequirement({
  id: 'REQ-GNSS-001',
  statement:
    'GNSS position fix shall remain available throughout the flight, with no single loss exceeding ' +
    'the provisional tolerance.',
  ruleId: 'analysis:gps-availability',
  subject: 'GNSS fix',
  signalGroups: [['gps.fix_type']],
  documentation: {
    applicability:
      'Applies to any flight logging a GNSS fix type. A deliberately GPS-denied test, or a vehicle ' +
      'with no receiver, produces NOT_APPLICABLE rather than a failure.',
    inputs: ['finding:analysis:gps-availability', 'gps.fix_type'],
    formula:
      'Take the interval gps.fix_type carried value-bearing samples over. If none, INCONCLUSIVE. ' +
      'Otherwise FAIL when analysis:gps-availability produced any finding, PASS when it produced ' +
      'none.',
    units: 'Fix type is a dimensionless firmware enum; time in seconds on the dataset time base.',
    thresholds: [],
    assumptions: [
      'The flight depended on GNSS position. Nothing in the dataset states this, so it is an ' +
        'assumption a reader must confirm against the test card.',
      'The tolerated outage length lives in analysis:gps-availability and is provisional.',
    ],
    evidence:
      'A signal-window over the interval gps.fix_type carried usable samples, plus every ' +
      'EvidenceRef of each contributing finding when the outcome is FAIL.',
  },
});

// ---------------------------------------------------------------------------------------------
// REQ-VIB-001 — vibration
// ---------------------------------------------------------------------------------------------

export const VIBRATION_REQUIREMENT: RequirementDefinition = analysisBackedRequirement({
  id: 'REQ-VIB-001',
  statement:
    'Airframe vibration shall remain within the provisional peak criterion for the whole flight.',
  ruleId: 'analysis:vibration-level',
  subject: 'vibration',
  signalGroups: [['vibration.x', 'vibration.y', 'vibration.z']],
  documentation: {
    applicability:
      'Applies to any flight logging all three vibration axes. A partial axis set is not enough to ' +
      'judge airframe vibration and produces NOT_APPLICABLE.',
    inputs: ['finding:analysis:vibration-level', 'vibration.x', 'vibration.y', 'vibration.z'],
    formula:
      'Take the interval each vibration axis carried value-bearing samples over. If none did, ' +
      'INCONCLUSIVE. Otherwise FAIL when analysis:vibration-level produced any finding, PASS when ' +
      'it produced none.',
    units: 'Acceleration in canonical m/s^2; time in seconds on the dataset time base.',
    thresholds: [],
    assumptions: [
      'The peak criterion lives in analysis:vibration-level, is provisional, and is ' +
        'airframe-independent — which is almost certainly wrong for a real fleet.',
      'All three axes are logged on one clock, so their examined intervals are comparable.',
    ],
    evidence:
      'A signal-window per vibration axis bounding the interval that carried usable samples, plus ' +
      'every EvidenceRef of each contributing finding when the outcome is FAIL.',
  },
});
