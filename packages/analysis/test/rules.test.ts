/**
 * Rule set behaviour and contract compliance — doc 03 §4, doc 05 Phase E acceptance.
 *
 * Every rule runs here from a plain unit test with no `apps/web` anywhere in sight, which is doc 04
 * §1 rule 3's requirement made concrete.
 */
import { describe, expect, it } from 'vitest';

import {
  ATTITUDE_TRACKING_RULE,
  AnalysisError,
  createDefaultRuleRegistry,
  createRuleRegistry,
  GPS_AVAILABILITY_RULE,
  proposeHypotheses,
  runAnalysis,
  VIBRATION_LEVEL_RULE,
  type AnalysisContext,
} from '@pandalog/analysis';
import { createFlightEvent, type FlightEvent } from '@pandalog/events';

import { attitudeDataset, datasetOf, emptyDataset, vibrationDataset } from './support/datasets.js';

const now = () => new Date('2026-01-01T00:00:00.000Z');
const registry = createDefaultRuleRegistry();

const contextOf = (
  dataset: AnalysisContext['dataset'],
  events: FlightEvent[] = [],
): AnalysisContext => ({ dataset, events, now });

const detector = { name: 'events:test', version: '1.0.0' };

const gpsLossEvent = (start: number, end: number): FlightEvent =>
  createFlightEvent({
    id: `gps-loss@${String(start)}`,
    type: 'gps-fix-loss',
    t_start_seconds: start,
    t_end_seconds: end,
    sourceSignalIds: ['gps.fix_type'],
    detector,
    payload: { worstFixType: 1 },
  });

const vibrationEvent = (start: number, end: number, peak: number): FlightEvent =>
  createFlightEvent({
    id: `vibe@${String(start)}`,
    type: 'vibration-excursion',
    t_start_seconds: start,
    t_end_seconds: end,
    sourceSignalIds: ['vibration.x', 'vibration.y', 'vibration.z'],
    detector,
    payload: { peakMagnitude: peak },
  });

// ---------------------------------------------------------------------------------------------
// Contract compliance — doc 03 §4 requires every rule to document six things.
// ---------------------------------------------------------------------------------------------
describe('every registered rule satisfies the doc 03 §4 documentation contract', () => {
  const rules = registry.rules;

  it('ships the first rule set', () => {
    expect(rules.map((rule) => rule.id).sort()).toEqual([
      'analysis:attitude-tracking-error',
      'analysis:gps-availability',
      'analysis:vibration-level',
    ]);
  });

  it.each(registry.rules.map((rule) => [rule.id, rule] as const))(
    '%s documents inputs, formula, units, thresholds, assumptions and evidence',
    (_id, rule) => {
      expect(rule.documentation.inputs.length).toBeGreaterThan(0);
      expect(rule.documentation.formula.length).toBeGreaterThan(20);
      expect(rule.documentation.units.length).toBeGreaterThan(0);
      expect(rule.documentation.thresholds.length).toBeGreaterThan(0);
      expect(rule.documentation.assumptions.length).toBeGreaterThan(0);
      expect(rule.documentation.evidence.length).toBeGreaterThan(0);
    },
  );

  it.each(registry.rules.map((rule) => [rule.id, rule] as const))(
    '%s declares a basis for every threshold, none bare',
    (_id, rule) => {
      for (const threshold of rule.documentation.thresholds) {
        expect(threshold.basis).toMatch(/^(spec:.+|empirical:.+|provisional)$/);
        expect(threshold.unit.length).toBeGreaterThan(0);
        expect(Number.isFinite(threshold.value)).toBe(true);
      }
    },
  );

  it.each(registry.rules.map((rule) => [rule.id, rule] as const))(
    '%s declares a semver version',
    (_id, rule) => {
      expect(rule.version).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Attitude tracking
// ---------------------------------------------------------------------------------------------
describe('analysis:attitude-tracking-error', () => {
  it('does not apply to a flight with no attitude logging', () => {
    expect(ATTITUDE_TRACKING_RULE.appliesWhen(contextOf(emptyDataset()))).toBe(false);
  });

  it('applies when desired and actual attitude are both present', () => {
    expect(ATTITUDE_TRACKING_RULE.appliesWhen(contextOf(attitudeDataset({ errorRad: 0 })))).toBe(
      true,
    );
  });

  it('finds nothing when tracking is good', () => {
    const result = ATTITUDE_TRACKING_RULE.evaluate(contextOf(attitudeDataset({ errorRad: 0.001 })));

    expect(result.findings).toEqual([]);
  });

  it('reports a finding when RMS error exceeds the criterion', () => {
    // 0.2 rad of steady error is well above the 0.0873 rad criterion.
    const result = ATTITUDE_TRACKING_RULE.evaluate(contextOf(attitudeDataset({ errorRad: 0.2 })));

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]?.statement).toContain('exceeded the configured criterion');
  });

  it('attaches evidence naming both the desired and actual signals', () => {
    const result = ATTITUDE_TRACKING_RULE.evaluate(contextOf(attitudeDataset({ errorRad: 0.2 })));
    const kinds = result.findings[0]?.evidence.map((reference) => reference.kind) ?? [];
    const signals = (result.findings[0]?.evidence ?? [])
      .filter((reference) => reference.kind === 'signal-window')
      .map((reference) => reference.signalId);

    expect(kinds).toContain('signal-window');
    expect(kinds).toContain('measurement');
    expect(signals).toContain('attitude.roll');
    expect(signals).toContain('attitude.roll.desired');
  });

  it('reports values in canonical radians, not degrees', () => {
    const result = ATTITUDE_TRACKING_RULE.evaluate(contextOf(attitudeDataset({ errorRad: 0.2 })));

    expect(result.findings[0]?.measurements[0]?.unit).toBe('rad');
  });

  it('says in its statement that the criterion is provisional (doc 03 §4)', () => {
    const result = ATTITUDE_TRACKING_RULE.evaluate(contextOf(attitudeDataset({ errorRad: 0.2 })));

    expect(result.findings[0]?.statement).toContain('provisional');
  });

  it('carries every threshold it used into the finding', () => {
    const result = ATTITUDE_TRACKING_RULE.evaluate(contextOf(attitudeDataset({ errorRad: 0.2 })));

    expect(result.findings[0]?.thresholds.length).toBe(
      ATTITUDE_TRACKING_RULE.documentation.thresholds.length,
    );
  });

  it('is deterministic across repeated runs (doc 03 §6)', () => {
    const context = contextOf(attitudeDataset({ errorRad: 0.2 }));

    expect(JSON.stringify(ATTITUDE_TRACKING_RULE.evaluate(context))).toBe(
      JSON.stringify(ATTITUDE_TRACKING_RULE.evaluate(context)),
    );
  });

  it('finds nothing in a dataset whose attitude samples are all missing', () => {
    const result = ATTITUDE_TRACKING_RULE.evaluate(
      contextOf(attitudeDataset({ errorRad: 0.2, allMissing: true })),
    );

    expect(result.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// GPS availability
// ---------------------------------------------------------------------------------------------
describe('analysis:gps-availability', () => {
  const dataset = datasetOf(['gps.fix_type']);

  it('does not apply without GPS logging', () => {
    expect(GPS_AVAILABILITY_RULE.appliesWhen(contextOf(emptyDataset()))).toBe(false);
  });

  it('finds nothing when there are no fix-loss events', () => {
    expect(GPS_AVAILABILITY_RULE.evaluate(contextOf(dataset, [])).findings).toEqual([]);
  });

  it('finds nothing for a dropout within tolerance', () => {
    const result = GPS_AVAILABILITY_RULE.evaluate(contextOf(dataset, [gpsLossEvent(1, 2)]));

    expect(result.findings).toEqual([]);
  });

  it('boundary: a dropout exactly at the tolerance is not a finding', () => {
    const result = GPS_AVAILABILITY_RULE.evaluate(contextOf(dataset, [gpsLossEvent(1, 3)]));

    expect(result.findings).toEqual([]);
  });

  it('reports a finding for a dropout beyond tolerance', () => {
    const result = GPS_AVAILABILITY_RULE.evaluate(contextOf(dataset, [gpsLossEvent(1, 5)]));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.measurements[0]?.value).toBeCloseTo(4, 9);
  });

  it('cites the originating event as evidence', () => {
    const result = GPS_AVAILABILITY_RULE.evaluate(contextOf(dataset, [gpsLossEvent(1, 5)]));
    const eventRefs = (result.findings[0]?.evidence ?? []).filter(
      (reference) => reference.kind === 'event',
    );

    expect(eventRefs).toHaveLength(1);
  });

  it('ignores events of other types', () => {
    const result = GPS_AVAILABILITY_RULE.evaluate(contextOf(dataset, [vibrationEvent(1, 5, 100)]));

    expect(result.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Vibration level
// ---------------------------------------------------------------------------------------------
describe('analysis:vibration-level', () => {
  const dataset = vibrationDataset();

  it('does not apply without three-axis vibration logging', () => {
    expect(VIBRATION_LEVEL_RULE.appliesWhen(contextOf(emptyDataset()))).toBe(false);
  });

  it('reports a finding for a sustained excursion above the criterion', () => {
    const result = VIBRATION_LEVEL_RULE.evaluate(contextOf(dataset, [vibrationEvent(1, 4, 45)]));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.measurements[0]?.value).toBe(45);
  });

  it('boundary: a peak exactly at the criterion is not a finding', () => {
    const result = VIBRATION_LEVEL_RULE.evaluate(contextOf(dataset, [vibrationEvent(1, 4, 30)]));

    expect(result.findings).toEqual([]);
  });

  it('boundary: an excursion shorter than the reportable minimum is not a finding', () => {
    const result = VIBRATION_LEVEL_RULE.evaluate(contextOf(dataset, [vibrationEvent(1, 1.5, 90)]));

    expect(result.findings).toEqual([]);
  });

  it('malformed: an event without a numeric peak is skipped rather than assumed', () => {
    const malformed = createFlightEvent({
      id: 'v',
      type: 'vibration-excursion',
      t_start_seconds: 1,
      t_end_seconds: 4,
      sourceSignalIds: ['vibration.x'],
      detector,
      payload: {},
    });

    expect(VIBRATION_LEVEL_RULE.evaluate(contextOf(dataset, [malformed])).findings).toEqual([]);
  });

  it('cites every axis the detector used', () => {
    const result = VIBRATION_LEVEL_RULE.evaluate(contextOf(dataset, [vibrationEvent(1, 4, 45)]));
    const signals = (result.findings[0]?.evidence ?? [])
      .filter((reference) => reference.kind === 'signal-window')
      .map((reference) => reference.signalId);

    expect(signals).toEqual(['vibration.x', 'vibration.y', 'vibration.z']);
  });
});

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------
describe('runAnalysis', () => {
  it('records rules that did not apply, rather than treating them as passes', () => {
    const result = runAnalysis(registry, contextOf(emptyDataset()));

    expect(result.findings).toEqual([]);
    expect(result.notApplicableRuleIds).toEqual([
      'analysis:attitude-tracking-error',
      'analysis:gps-availability',
      'analysis:vibration-level',
    ]);
  });

  it('records every rule it ran and the version it ran at', () => {
    // Doc 04 §7 requires a report to embed the rule-set version. Without this, a rule that applied
    // and found nothing leaves no trace at all — indistinguishable from a rule that was never
    // registered — so a report could not state what the flight was actually checked against.
    const result = runAnalysis(registry, contextOf(emptyDataset()));

    expect(result.executedRules).toEqual([
      { id: 'analysis:attitude-tracking-error', version: '1.0.0', applied: false },
      { id: 'analysis:gps-availability', version: '1.0.0', applied: false },
      { id: 'analysis:vibration-level', version: '1.0.0', applied: false },
    ]);
  });

  it('distinguishes a rule that applied and stayed silent from one that did not apply', () => {
    const registryOfOne = createRuleRegistry([GPS_AVAILABILITY_RULE]);
    // The dataset carries the signal the rule needs, so it applies; there is no fix-loss event, so
    // it produces nothing. "Checked and clean" is not "never checked".
    const context = contextOf(vibrationDataset(['gps.fix_type']), []);

    const result = runAnalysis(registryOfOne, context);

    expect(result.findings).toEqual([]);
    expect(result.notApplicableRuleIds).toEqual([]);
    expect(result.executedRules).toEqual([
      { id: 'analysis:gps-availability', version: '1.0.0', applied: true },
    ]);
  });

  it('lists executed rules in a stable order regardless of registration order', () => {
    const forward = createRuleRegistry([GPS_AVAILABILITY_RULE, VIBRATION_LEVEL_RULE]);
    const reversed = createRuleRegistry([VIBRATION_LEVEL_RULE, GPS_AVAILABILITY_RULE]);
    const context = contextOf(emptyDataset());

    expect(runAnalysis(forward, context).executedRules).toEqual(
      runAnalysis(reversed, context).executedRules,
    );
  });

  it('is deterministic regardless of registration order', () => {
    const forward = createRuleRegistry([GPS_AVAILABILITY_RULE, VIBRATION_LEVEL_RULE]);
    const reversed = createRuleRegistry([VIBRATION_LEVEL_RULE, GPS_AVAILABILITY_RULE]);
    const context = contextOf(vibrationDataset(['gps.fix_type']), [
      gpsLossEvent(1, 5),
      vibrationEvent(1, 4, 45),
    ]);

    expect(runAnalysis(forward, context).findings.map((f) => f.id)).toEqual(
      runAnalysis(reversed, context).findings.map((f) => f.id),
    );
  });

  it('rejects two rules sharing an id', () => {
    expect(() => createRuleRegistry([GPS_AVAILABILITY_RULE, GPS_AVAILABILITY_RULE])).toThrow(
      AnalysisError,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Hypotheses
// ---------------------------------------------------------------------------------------------
describe('proposeHypotheses', () => {
  const context = contextOf(vibrationDataset(), [vibrationEvent(1, 4, 45)]);
  const vibrationFindings = VIBRATION_LEVEL_RULE.evaluate(context).findings;
  const trackingFindings = ATTITUDE_TRACKING_RULE.evaluate(
    contextOf(attitudeDataset({ errorRad: 0.2 })),
  ).findings;

  it('proposes nothing from a single finding', () => {
    expect(proposeHypotheses(vibrationFindings)).toEqual([]);
  });

  it('proposes an explanation when a vibration excursion overlaps a tracking exceedance', () => {
    const hypotheses = proposeHypotheses([...vibrationFindings, ...trackingFindings]);

    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses[0]?.relatedFindingIds).toHaveLength(2);
  });

  it('states plainly that causation is not established', () => {
    const hypotheses = proposeHypotheses([...vibrationFindings, ...trackingFindings]);

    expect(hypotheses[0]?.statement).toContain('may have contributed');
    expect(hypotheses[0]?.statement).toContain('not established');
  });

  it('produces UNCONFIRMED hypotheses that carry no severity', () => {
    const hypotheses = proposeHypotheses([...vibrationFindings, ...trackingFindings]);

    expect(hypotheses[0]?.status).toBe('UNCONFIRMED');
    expect(hypotheses[0]).not.toHaveProperty('severity');
  });
});
