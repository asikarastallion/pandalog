/**
 * Attitude tracking error against a criterion.
 *
 * Doc 03 §1's worked example is exactly this rule:
 *
 *   Measurement : Roll RMS error = 6.2 deg over t=[102.4, 118.9]
 *   Event       : "roll-tracking-window" opened at t=102.4, closed at t=118.9
 *   Finding     : Roll tracking exceeded the configured criterion
 *   Hypothesis  : Possible actuator saturation contributed
 *   Root cause  : Not established
 *
 * Values here stay in canonical radians rather than being converted to degrees for readability.
 * Presenting a number in the unit an engineer prefers is a display concern (Phase H); doing it in
 * the analysis layer would put a unit conversion outside core-domain (doc 04 §1 rule 7).
 */
import { findThresholdRuns } from '@pandalog/events';
import {
  alignSignals,
  commonTimeSpan,
  createDerivationRegistry,
  deriveSignal,
  uniformGrid,
} from '@pandalog/query';
import type { Signal } from '@pandalog/schema';

import { createFinding, findingId, type ThresholdRecord } from '../finding.js';
import type { AnalysisContext, AnalysisRule, RuleResult } from '../rule.js';

const RULE_VERSION = '1.0.0';

/**
 * RMS tracking-error criterion, in canonical radians (0.0873 rad = 5.0 deg).
 *
 * basis: provisional. It mirrors the illustrative 5.0 deg criterion in doc 03 §1 so the rule has a
 * concrete number to work with; no flight-test document in this repository establishes it, and the
 * right figure depends on airframe, control tuning and the manoeuvre being flown. The Finding says
 * so in its statement, per doc 03 §4's requirement that a provisional rule not present itself as
 * settled.
 */
const RMS_ERROR_CRITERION_RAD = 0.0873;

/** Window the RMS is computed over. basis: provisional — see above. */
const RMS_WINDOW_SECONDS = 2;

/** Shortest exceedance worth reporting, so a momentary spike is not a Finding. */
const MIN_EXCEEDANCE_SECONDS = 1;

/** Resample rate for aligning desired against actual. basis: provisional. */
const ANALYSIS_RATE_HZ = 10;

/** Largest gap the aligner may interpolate across before marking data MISSING. */
const MAX_GAP_SECONDS = 0.5;

const THRESHOLDS: readonly ThresholdRecord[] = Object.freeze([
  {
    label: 'RMS tracking error criterion',
    value: RMS_ERROR_CRITERION_RAD,
    unit: 'rad',
    basis: 'provisional',
  },
  { label: 'RMS window', value: RMS_WINDOW_SECONDS, unit: 's', basis: 'provisional' },
  {
    label: 'Minimum exceedance duration',
    value: MIN_EXCEEDANCE_SECONDS,
    unit: 's',
    basis: 'provisional',
  },
  {
    label: 'Analysis resample rate',
    value: ANALYSIS_RATE_HZ,
    unit: 'unitless',
    basis: 'provisional',
  },
  { label: 'Maximum interpolation gap', value: MAX_GAP_SECONDS, unit: 's', basis: 'provisional' },
]);

interface AxisConfig {
  readonly axis: 'roll' | 'pitch';
  readonly actualId: string;
  readonly desiredId: string;
}

const AXES: readonly AxisConfig[] = Object.freeze([
  { axis: 'roll', actualId: 'attitude.roll', desiredId: 'attitude.roll.desired' },
  { axis: 'pitch', actualId: 'attitude.pitch', desiredId: 'attitude.pitch.desired' },
]);

function axisSignals(context: AnalysisContext, config: AxisConfig): [Signal, Signal] | null {
  const actual = context.dataset.signals.get(config.actualId);
  const desired = context.dataset.signals.get(config.desiredId);
  return actual === undefined || desired === undefined ? null : [desired, actual];
}

export const ATTITUDE_TRACKING_RULE: AnalysisRule = {
  id: 'analysis:attitude-tracking-error',
  version: RULE_VERSION,

  documentation: {
    inputs: ['attitude.roll', 'attitude.roll.desired', 'attitude.pitch', 'attitude.pitch.desired'],
    formula:
      'Align desired and actual onto a uniform 10 Hz grid. error(t) = desired(t) - actual(t). ' +
      'rms(t) = sqrt(mean(error^2)) over the trailing 2 s window, computed by ' +
      'query:rolling-rms v1.0.0. Report a finding for every contiguous run where rms(t) exceeds ' +
      'the criterion for at least 1 s.',
    units:
      'Angles in canonical radians throughout; time in seconds on the dataset time base. The ' +
      'criterion is stated in radians (0.0873 rad = 5.0 deg).',
    thresholds: THRESHOLDS,
    assumptions: [
      'The vehicle logs a commanded attitude alongside the measured one; without both, tracking ' +
        'error is undefined and the rule does not apply.',
      'Desired and actual are logged on one clock, so aligning them needs no cross-clock ' +
        'synchronisation claim.',
      'No branching on vehicle type or flight mode yet: the criterion is provisional and would ' +
        'need to differ by airframe and manoeuvre before it could be treated as settled.',
    ],
    evidence:
      'A signal-window over the exceedance interval for both the desired and actual signals, plus ' +
      'a measurement citing the peak RMS error and the instant it occurred.',
  },

  appliesWhen(context: AnalysisContext): boolean {
    return AXES.some((config) => axisSignals(context, config) !== null);
  },

  evaluate(context: AnalysisContext): RuleResult {
    const producedAtUtc = context.now().toISOString();
    const derivations = createDerivationRegistry();
    const findings = [];

    for (const config of AXES) {
      const signals = axisSignals(context, config);
      if (signals === null) {
        continue;
      }

      const span = commonTimeSpan(signals);
      if (span === null) {
        continue;
      }

      const aligned = alignSignals(signals, {
        times: uniformGrid(span.startSeconds, span.endSeconds, ANALYSIS_RATE_HZ),
        maxGapSeconds: MAX_GAP_SECONDS,
      });

      const [desired, actual] = aligned.signals;
      if (desired === undefined || actual === undefined) {
        continue;
      }

      const error = deriveSignal(derivations, {
        id: `attitude.${config.axis}.error`,
        method: 'query:difference',
        inputs: [desired, actual],
      });

      const rms = deriveSignal(derivations, {
        id: `attitude.${config.axis}.error.rms`,
        method: 'query:rolling-rms',
        inputs: [error],
        parameters: { windowSeconds: RMS_WINDOW_SECONDS },
      });

      const runs = findThresholdRuns(rms, {
        threshold: RMS_ERROR_CRITERION_RAD,
        direction: 'above',
        minDurationSeconds: MIN_EXCEEDANCE_SECONDS,
      });

      for (const [ordinal, run] of runs.entries()) {
        findings.push(
          createFinding({
            id: findingId(`${ATTITUDE_TRACKING_RULE.id}:${config.axis}`, run.startSeconds, ordinal),
            ruleId: ATTITUDE_TRACKING_RULE.id,
            ruleVersion: RULE_VERSION,
            statement:
              `${config.axis === 'roll' ? 'Roll' : 'Pitch'} tracking exceeded the configured ` +
              `criterion (peak RMS error ${run.extremeValue.toFixed(4)} rad against a ` +
              `${String(RMS_ERROR_CRITERION_RAD)} rad criterion) for ` +
              `${(run.endSeconds - run.startSeconds).toFixed(2)} s. The criterion is provisional ` +
              'and is not traceable to a flight-test requirement.',
            severity: 'WARNING',
            evidence: [
              {
                kind: 'signal-window',
                signalId: config.actualId,
                t_start_seconds: run.startSeconds,
                t_end_seconds: run.endSeconds,
              },
              {
                kind: 'signal-window',
                signalId: config.desiredId,
                t_start_seconds: run.startSeconds,
                t_end_seconds: run.endSeconds,
              },
              {
                kind: 'measurement',
                signalId: rms.id,
                t_seconds: run.endSeconds,
                value: run.extremeValue,
                unit: 'rad',
              },
            ],
            measurements: [
              { label: 'Peak RMS tracking error', value: run.extremeValue, unit: 'rad' },
              {
                label: 'Exceedance duration',
                value: run.endSeconds - run.startSeconds,
                unit: 's',
              },
            ],
            thresholds: THRESHOLDS,
            producedAtUtc,
          }),
        );
      }
    }

    return { findings };
  },
};
