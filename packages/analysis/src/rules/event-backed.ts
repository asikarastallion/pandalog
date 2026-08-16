/**
 * Rules that turn detected events into claims.
 *
 * The division of labour matters here (doc 03 §1). Phase D's detectors established *facts*: the
 * vibration magnitude was above X between t1 and t2; the GPS fix was below 3D between t3 and t4.
 * These rules make the *claims*: that those facts exceed a criterion someone can sign off against.
 * The detector does not decide whether a 0.4 s dropout mattered — that judgement lives here, with a
 * threshold that declares where it came from.
 */
import type { FlightEvent } from '@pandalog/events';

import type { EvidenceRef } from '../evidence.js';
import { createFinding, findingId, type ThresholdRecord } from '../finding.js';
import type { AnalysisContext, AnalysisRule, RuleResult } from '../rule.js';

const RULE_VERSION = '1.0.0';

// ---------------------------------------------------------------------------------------------
// GPS availability
// ---------------------------------------------------------------------------------------------

/**
 * Longest single fix loss tolerated before it becomes a finding.
 *
 * basis: provisional. Whether a 2 s dropout matters depends entirely on what the flight was doing
 * — a position-hold manoeuvre and a manual-mode pass have completely different tolerances — and no
 * requirement document here states one.
 */
const MAX_TOLERATED_FIX_LOSS_SECONDS = 2;

const GPS_THRESHOLDS: readonly ThresholdRecord[] = Object.freeze([
  {
    label: 'Maximum tolerated GPS fix loss',
    value: MAX_TOLERATED_FIX_LOSS_SECONDS,
    unit: 's',
    basis: 'provisional',
  },
]);

const durationOf = (event: FlightEvent): number =>
  event.t_end_seconds === null ? 0 : event.t_end_seconds - event.t_start_seconds;

const eventsOfType = (context: AnalysisContext, type: string): FlightEvent[] =>
  context.events.filter((event) => event.type === type);

export const GPS_AVAILABILITY_RULE: AnalysisRule = {
  id: 'analysis:gps-availability',
  version: RULE_VERSION,

  documentation: {
    inputs: ['event:gps-fix-loss', 'gps.fix_type'],
    formula:
      'For each gps-fix-loss event, duration = t_end - t_start. Report a finding for every event ' +
      'whose duration exceeds the tolerated maximum.',
    units: 'Durations in seconds; fix type is a dimensionless firmware enum.',
    thresholds: GPS_THRESHOLDS,
    assumptions: [
      'The flight depended on GNSS position. A deliberately GPS-denied test would need this rule ' +
        'to be inapplicable rather than failing, which is Phase F NOT_APPLICABLE territory.',
      'Fix-loss events come from events:gps-fix-loss, which reads the firmware fix-type enum.',
    ],
    evidence:
      'The originating event, a signal-window over gps.fix_type for the outage, and a measurement ' +
      'citing the worst fix type reached.',
  },

  appliesWhen(context: AnalysisContext): boolean {
    return context.dataset.signals.has('gps.fix_type');
  },

  evaluate(context: AnalysisContext): RuleResult {
    const producedAtUtc = context.now().toISOString();
    const findings = [];

    for (const [ordinal, event] of eventsOfType(context, 'gps-fix-loss').entries()) {
      const duration = durationOf(event);
      if (duration <= MAX_TOLERATED_FIX_LOSS_SECONDS) {
        continue;
      }

      const evidence: EvidenceRef[] = [
        { kind: 'event', eventId: event.id },
        {
          kind: 'signal-window',
          signalId: 'gps.fix_type',
          t_start_seconds: event.t_start_seconds,
          t_end_seconds: event.t_end_seconds ?? event.t_start_seconds,
        },
      ];

      const worst = event.payload.worstFixType;
      if (typeof worst === 'number' && Number.isFinite(worst)) {
        evidence.push({
          kind: 'measurement',
          signalId: 'gps.fix_type',
          t_seconds: event.t_start_seconds,
          value: worst,
          unit: 'unitless',
        });
      }

      findings.push(
        createFinding({
          id: findingId(GPS_AVAILABILITY_RULE.id, event.t_start_seconds, ordinal),
          ruleId: GPS_AVAILABILITY_RULE.id,
          ruleVersion: RULE_VERSION,
          statement:
            `GPS fix was lost for ${duration.toFixed(2)} s, exceeding the tolerated maximum of ` +
            `${String(MAX_TOLERATED_FIX_LOSS_SECONDS)} s. The tolerance is provisional and is not ` +
            'traceable to a flight-test requirement.',
          severity: 'WARNING',
          evidence,
          measurements: [{ label: 'Fix loss duration', value: duration, unit: 's' }],
          thresholds: GPS_THRESHOLDS,
          producedAtUtc,
        }),
      );
    }

    return { findings };
  },
};

// ---------------------------------------------------------------------------------------------
// Vibration level
// ---------------------------------------------------------------------------------------------

/**
 * Peak vibration magnitude above which the excursion becomes a finding.
 *
 * basis: provisional, and inherited from the same rule of thumb the Phase D detector uses. The
 * detector's job was to notice the excursion; this rule's job is to claim it was too high, and
 * neither number is traceable to a document in this repository.
 */
const VIBRATION_PEAK_CRITERION_M_PER_S2 = 30;

/** Shortest excursion worth claiming as a finding rather than noting as an event. */
const MIN_REPORTABLE_EXCURSION_SECONDS = 1;

const VIBRATION_THRESHOLDS: readonly ThresholdRecord[] = Object.freeze([
  {
    label: 'Peak vibration criterion',
    value: VIBRATION_PEAK_CRITERION_M_PER_S2,
    unit: 'm/s^2',
    basis: 'provisional',
  },
  {
    label: 'Minimum reportable excursion',
    value: MIN_REPORTABLE_EXCURSION_SECONDS,
    unit: 's',
    basis: 'provisional',
  },
]);

export const VIBRATION_LEVEL_RULE: AnalysisRule = {
  id: 'analysis:vibration-level',
  version: RULE_VERSION,

  documentation: {
    inputs: ['event:vibration-excursion', 'vibration.x', 'vibration.y', 'vibration.z'],
    formula:
      'For each vibration-excursion event, take the peak magnitude the detector recorded and the ' +
      'event duration. Report a finding when the peak exceeds the criterion and the excursion ' +
      'lasted at least the minimum reportable duration.',
    units: 'Acceleration in canonical m/s^2; durations in seconds.',
    thresholds: VIBRATION_THRESHOLDS,
    assumptions: [
      'The vehicle logs three-axis vibration (ArduPilot VIBE). Without it the rule does not apply.',
      'The criterion is airframe-independent, which is almost certainly wrong for a real fleet — ' +
        'it is why the threshold is marked provisional rather than spec.',
    ],
    evidence:
      'The originating event, a signal-window over each vibration axis for the excursion, and a ' +
      'measurement citing the peak magnitude.',
  },

  appliesWhen(context: AnalysisContext): boolean {
    return (
      context.dataset.signals.has('vibration.x') &&
      context.dataset.signals.has('vibration.y') &&
      context.dataset.signals.has('vibration.z')
    );
  },

  evaluate(context: AnalysisContext): RuleResult {
    const producedAtUtc = context.now().toISOString();
    const findings = [];

    for (const [ordinal, event] of eventsOfType(context, 'vibration-excursion').entries()) {
      const peak = event.payload.peakMagnitude;
      const duration = durationOf(event);

      if (typeof peak !== 'number' || !Number.isFinite(peak)) {
        continue;
      }
      if (peak <= VIBRATION_PEAK_CRITERION_M_PER_S2) {
        continue;
      }
      if (duration < MIN_REPORTABLE_EXCURSION_SECONDS) {
        continue;
      }

      const evidence: EvidenceRef[] = [
        { kind: 'event', eventId: event.id },
        ...event.sourceSignalIds.map((signalId): EvidenceRef => ({
          kind: 'signal-window',
          signalId,
          t_start_seconds: event.t_start_seconds,
          t_end_seconds: event.t_end_seconds ?? event.t_start_seconds,
        })),
        {
          kind: 'measurement',
          signalId: 'vibration.magnitude',
          t_seconds: event.t_start_seconds,
          value: peak,
          unit: 'm/s^2',
        },
      ];

      findings.push(
        createFinding({
          id: findingId(VIBRATION_LEVEL_RULE.id, event.t_start_seconds, ordinal),
          ruleId: VIBRATION_LEVEL_RULE.id,
          ruleVersion: RULE_VERSION,
          statement:
            `Vibration magnitude peaked at ${peak.toFixed(2)} m/s^2 against a ` +
            `${String(VIBRATION_PEAK_CRITERION_M_PER_S2)} m/s^2 criterion, sustained for ` +
            `${duration.toFixed(2)} s. The criterion is provisional and airframe-independent.`,
          severity: 'WARNING',
          evidence,
          measurements: [
            { label: 'Peak vibration magnitude', value: peak, unit: 'm/s^2' },
            { label: 'Excursion duration', value: duration, unit: 's' },
          ],
          thresholds: VIBRATION_THRESHOLDS,
          producedAtUtc,
        }),
      );
    }

    return { findings };
  },
};
