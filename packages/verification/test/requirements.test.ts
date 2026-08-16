/**
 * The provisional requirement set — doc 05 Phase F.
 *
 * The acceptance criterion this file exists for:
 *
 * > Missing evidence always yields INCONCLUSIVE, verified by a test that withholds evidence and
 * > asserts the outcome is never PASS.
 *
 * "Withholding evidence" is tested three ways, because there are three different ways a flight can
 * fail to support a claim: the signal is absent entirely, the signal is present but carries nothing
 * usable (every sample MISSING), and the log carried no discrete records at all.
 */
import { describe, expect, it } from 'vitest';

import {
  ATTITUDE_TRACKING_REQUIREMENT,
  GNSS_AVAILABILITY_REQUIREMENT,
  NO_LOGGED_ERROR_REQUIREMENT,
  PROVISIONAL_REQUIREMENT_SET_V1,
  VIBRATION_REQUIREMENT,
  verifyRequirements,
  type RequirementContext,
  type RequirementDefinition,
} from '@pandalog/verification';

import {
  ALL_SIGNALS,
  ATTITUDE_SIGNALS,
  contextOf,
  datasetOf,
  finding,
  loggedRecord,
  VIBRATION_SIGNALS,
} from './support/context.js';

/** Run one requirement the way the harness does, so applicability is honoured. */
const evaluate = (requirement: RequirementDefinition, context: RequirementContext) =>
  requirement.appliesWhen(context)
    ? requirement.evaluate(context)
    : { outcome: 'NOT_APPLICABLE' as const };

const missing = (ids: readonly string[]) => datasetOf(ids.map((id) => ({ id, allMissing: true })));

describe('REQ-ATT-001 — attitude tracking', () => {
  it('does not apply when the vehicle logs no commanded attitude', () => {
    const context = contextOf({ dataset: datasetOf(['attitude.roll']) });

    expect(ATTITUDE_TRACKING_REQUIREMENT.appliesWhen(context)).toBe(false);
  });

  it('applies when one axis logs both desired and actual', () => {
    const context = contextOf({
      dataset: datasetOf(['attitude.roll', 'attitude.roll.desired']),
    });

    expect(ATTITUDE_TRACKING_REQUIREMENT.appliesWhen(context)).toBe(true);
  });

  it('passes when the analysis layer found no tracking exceedance', () => {
    const result = evaluate(ATTITUDE_TRACKING_REQUIREMENT, contextOf({}));

    expect(result.outcome).toBe('PASS');
  });

  it('cites the window it examined, so a PASS is not a bare assertion', () => {
    const result = ATTITUDE_TRACKING_REQUIREMENT.evaluate(contextOf({}));

    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((ref) => ref.kind === 'signal-window')).toBe(true);
  });

  it('fails when a tracking finding exists, and carries that finding’s evidence', () => {
    const context = contextOf({
      findings: [finding('analysis:attitude-tracking-error')],
    });

    const result = ATTITUDE_TRACKING_REQUIREMENT.evaluate(context);

    expect(result.outcome).toBe('FAIL');
    expect(result.evidence.some((ref) => ref.kind === 'event')).toBe(true);
  });

  it('ignores findings from other rules', () => {
    const context = contextOf({ findings: [finding('analysis:vibration-level')] });

    expect(ATTITUDE_TRACKING_REQUIREMENT.evaluate(context).outcome).toBe('PASS');
  });

  it('is INCONCLUSIVE — never PASS — when every attitude sample is MISSING', () => {
    const context = contextOf({ dataset: missing(ATTITUDE_SIGNALS) });

    expect(ATTITUDE_TRACKING_REQUIREMENT.evaluate(context).outcome).toBe('INCONCLUSIVE');
  });

  it('says what was missing, so the engineer knows what to log next time', () => {
    const context = contextOf({ dataset: missing(ATTITUDE_SIGNALS) });

    expect(ATTITUDE_TRACKING_REQUIREMENT.evaluate(context).reason).toContain('attitude');
  });
});

describe('REQ-GNSS-001 — GNSS availability', () => {
  it('does not apply to a flight with no GNSS log', () => {
    const context = contextOf({ dataset: datasetOf(ATTITUDE_SIGNALS) });

    expect(GNSS_AVAILABILITY_REQUIREMENT.appliesWhen(context)).toBe(false);
  });

  it('passes when no fix-loss finding was raised', () => {
    expect(GNSS_AVAILABILITY_REQUIREMENT.evaluate(contextOf({})).outcome).toBe('PASS');
  });

  it('fails when the analysis layer raised a fix-loss finding', () => {
    const context = contextOf({ findings: [finding('analysis:gps-availability')] });

    expect(GNSS_AVAILABILITY_REQUIREMENT.evaluate(context).outcome).toBe('FAIL');
  });

  it('is INCONCLUSIVE when the fix-type signal carries nothing usable', () => {
    const context = contextOf({ dataset: missing(['gps.fix_type']) });

    expect(GNSS_AVAILABILITY_REQUIREMENT.evaluate(context).outcome).toBe('INCONCLUSIVE');
  });
});

describe('REQ-VIB-001 — vibration', () => {
  it('does not apply when the vehicle logs fewer than three vibration axes', () => {
    const context = contextOf({ dataset: datasetOf(['vibration.x', 'vibration.y']) });

    expect(VIBRATION_REQUIREMENT.appliesWhen(context)).toBe(false);
  });

  it('passes when no vibration finding was raised', () => {
    expect(VIBRATION_REQUIREMENT.evaluate(contextOf({})).outcome).toBe('PASS');
  });

  it('fails when the analysis layer raised a vibration finding', () => {
    const context = contextOf({ findings: [finding('analysis:vibration-level')] });

    expect(VIBRATION_REQUIREMENT.evaluate(context).outcome).toBe('FAIL');
  });

  it('is INCONCLUSIVE when every vibration sample is MISSING', () => {
    const context = contextOf({ dataset: missing(VIBRATION_SIGNALS) });

    expect(VIBRATION_REQUIREMENT.evaluate(context).outcome).toBe('INCONCLUSIVE');
  });
});

describe('REQ-ERR-001 — no logged flight-controller error', () => {
  const records = [loggedRecord('r1', 'logged-message', 0), loggedRecord('r2', 'mode-change', 1.5)];

  it('applies to every flight — any log can carry an error record', () => {
    expect(NO_LOGGED_ERROR_REQUIREMENT.appliesWhen(contextOf({}))).toBe(true);
  });

  it('fails on a logged error, citing the error record itself', () => {
    const context = contextOf({
      events: [...records, loggedRecord('r3', 'logged-error', 2)],
    });

    const result = NO_LOGGED_ERROR_REQUIREMENT.evaluate(context);

    expect(result.outcome).toBe('FAIL');
    expect(result.evidence).toContainEqual({ kind: 'event', eventId: 'r3' });
  });

  it('passes when the log carried records and none of them was an error', () => {
    const result = NO_LOGGED_ERROR_REQUIREMENT.evaluate(contextOf({ events: records }));

    expect(result.outcome).toBe('PASS');
  });

  it('bounds a PASS with the first and last record examined', () => {
    const result = NO_LOGGED_ERROR_REQUIREMENT.evaluate(contextOf({ events: records }));

    expect(result.evidence).toEqual([
      { kind: 'event', eventId: 'r1' },
      { kind: 'event', eventId: 'r2' },
    ]);
  });

  it('is INCONCLUSIVE when the log carried no records at all — absence proves nothing', () => {
    const result = NO_LOGGED_ERROR_REQUIREMENT.evaluate(contextOf({ events: [] }));

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.reason).toContain('no');
  });

  it('ignores events derived from signals — they say nothing about error logging', () => {
    const context = contextOf({
      events: [
        {
          id: 'v1',
          type: 'vibration-excursion',
          t_start_seconds: 1,
          t_end_seconds: 2,
          sourceSignalIds: ['vibration.x'],
          detector: { name: 'events:vibration-excursion', version: '1.0.0' },
          payload: {},
        },
      ],
    });

    expect(NO_LOGGED_ERROR_REQUIREMENT.evaluate(context).outcome).toBe('INCONCLUSIVE');
  });
});

describe('withholding evidence from the whole set (Phase F acceptance)', () => {
  const never = (context: RequirementContext, label: string) => {
    const report = verifyRequirements(PROVISIONAL_REQUIREMENT_SET_V1, context);

    expect(report.summary.PASS, `${label} produced a PASS`).toBe(0);
    expect(report.evidenceRuleViolations).toEqual([]);
  };

  it('never yields PASS for a dataset with no signals and no events', () => {
    never(contextOf({ dataset: datasetOf([]) }), 'an empty dataset');
  });

  it('never yields PASS when every signal is present but carries nothing usable', () => {
    never(contextOf({ dataset: missing(ALL_SIGNALS) }), 'an all-MISSING dataset');
  });

  it('yields only INCONCLUSIVE or NOT_APPLICABLE for an empty dataset', () => {
    const report = verifyRequirements(
      PROVISIONAL_REQUIREMENT_SET_V1,
      contextOf({ dataset: datasetOf([]) }),
    );

    expect(report.results.every((r) => r.outcome !== 'PASS' && r.outcome !== 'FAIL')).toBe(true);
  });

  it('still fails a requirement whose failure evidence survives the data loss', () => {
    const report = verifyRequirements(
      PROVISIONAL_REQUIREMENT_SET_V1,
      contextOf({
        dataset: missing(ALL_SIGNALS),
        events: [loggedRecord('r3', 'logged-error', 2)],
      }),
    );

    expect(report.summary.FAIL).toBe(1);
    expect(report.summary.PASS).toBe(0);
  });
});
