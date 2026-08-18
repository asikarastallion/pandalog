/**
 * Grouping repeated findings for display, without becoming an analysis stage.
 *
 * Two properties matter and they pull against each other. The grouping has to be *useful* — a rule
 * that fired twenty-four times must read as one thing that happened twenty-four times — and it has
 * to be *empty of new claims*, because the moment a group states a number no Finding asserted, the
 * report contains a measurement that has no evidence behind it (doc 04 §7, doc 03 §3).
 *
 * The second property is the one that needs a control, so it has one: the sum of the very
 * measurements being grouped is computed here, confirmed absent from the inputs, and then confirmed
 * absent from every group. That is the number a helpful rollup would print.
 */
import { createFinding, type Finding } from '@pandalog/analysis';
import { describe, expect, it } from 'vitest';

import { groupFindings, isRepeated } from '@pandalog/reporting';

import { inputFor } from './support/artifacts.js';

const PRODUCED_AT = '2026-01-01T00:00:00.000Z';

/** One excursion of a tracking rule: the shape that repeats twenty-four times in a real log. */
function excursion(options: {
  readonly index: number;
  readonly signalId: string;
  readonly severity?: Finding['severity'];
  readonly peak: number;
  readonly startSeconds: number;
  readonly durationSeconds: number;
}): Finding {
  const end = options.startSeconds + options.durationSeconds;
  return createFinding({
    id: `finding:${options.signalId}:${String(options.index)}`,
    ruleId: 'analysis:attitude-tracking-error',
    ruleVersion: '1.0.0',
    statement: `Tracking exceeded the configured criterion for ${String(options.durationSeconds)} s.`,
    severity: options.severity ?? 'WARNING',
    evidence: [
      {
        kind: 'signal-window',
        signalId: options.signalId,
        t_start_seconds: options.startSeconds,
        t_end_seconds: end,
      },
    ],
    measurements: [
      { label: 'Peak RMS tracking error', value: options.peak, unit: 'rad' },
      { label: 'Exceedance duration', value: options.durationSeconds, unit: 's' },
    ],
    thresholds: [
      { label: 'RMS tracking error criterion', value: 0.0873, unit: 'rad', basis: 'provisional' },
    ],
    producedAtUtc: PRODUCED_AT,
  });
}

const pitchExcursions = [
  excursion({
    index: 0,
    signalId: 'attitude.pitch',
    peak: 0.21,
    startSeconds: 10,
    durationSeconds: 2.5,
  }),
  excursion({
    index: 1,
    signalId: 'attitude.pitch',
    peak: 0.341,
    startSeconds: 40,
    durationSeconds: 4,
  }),
  excursion({
    index: 2,
    signalId: 'attitude.pitch',
    peak: 0.18,
    startSeconds: 90,
    durationSeconds: 1.25,
  }),
];

const rollExcursion = excursion({
  index: 0,
  signalId: 'attitude.roll',
  peak: 0.5,
  startSeconds: 55,
  durationSeconds: 3,
});

describe('repetition becomes one group', () => {
  it('collapses findings that differ only in their numbers', () => {
    const [group, ...others] = groupFindings(pitchExcursions);

    expect(others).toEqual([]);
    expect(group?.count).toBe(3);
    expect(group === undefined ? null : isRepeated(group)).toBe(true);
  });

  it('keeps every original finding, unaltered and in order', () => {
    // The grouping is additive. If it dropped or rewrote a finding it would be destroying the
    // evidence chain doc 03 §3 exists to protect, in the name of a tidier page.
    const groups = groupFindings(pitchExcursions);

    expect(groups[0]?.findings).toEqual(pitchExcursions);
  });

  it('does not group two signals a single rule covers separately', () => {
    // One rule fires on roll and on pitch. A group spanning both would make a statement that is
    // true of neither axis alone.
    const groups = groupFindings([...pitchExcursions, rollExcursion]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.signalIds)).toEqual(
      expect.arrayContaining([['attitude.pitch'], ['attitude.roll']]),
    );
  });

  it('does not group two severities together', () => {
    const escalated = excursion({
      index: 9,
      signalId: 'attitude.pitch',
      severity: 'CRITICAL',
      peak: 0.9,
      startSeconds: 120,
      durationSeconds: 6,
    });

    const groups = groupFindings([...pitchExcursions, escalated]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.severity)).toEqual(['CRITICAL', 'WARNING']);
  });

  it('leaves a lone finding as a group of one rather than hiding it', () => {
    const [group, ...others] = groupFindings([rollExcursion]);

    expect(others).toEqual([]);
    expect(group?.count).toBe(1);
    expect(group === undefined ? null : isRepeated(group)).toBe(false);
  });

  it('returns nothing for no findings', () => {
    expect(groupFindings([])).toEqual([]);
  });
});

describe('a group states only what a finding already asserted', () => {
  it('selects the peak rather than deriving one, and names where it came from', () => {
    const groups = groupFindings(pitchExcursions);
    const peak = groups[0]?.peaks.find((entry) => entry.label === 'Peak RMS tracking error');

    expect(peak?.value).toBe(0.341);
    expect(peak?.unit).toBe('rad');
    // Traceability: the number is one evidenced claim's, and the group says which.
    expect(peak?.findingId).toBe('finding:attitude.pitch:1');
    expect(pitchExcursions.flatMap((f) => f.measurements.map((m) => m.value))).toContain(
      peak?.value,
    );
  });

  it('never compares two units as if they were one quantity', () => {
    const [template] = pitchExcursions;
    if (template === undefined) {
      throw new Error('The fixture list is empty.');
    }
    const inDegrees = createFinding({
      ...template,
      id: 'finding:attitude.pitch:deg',
      measurements: [{ label: 'Peak RMS tracking error', value: 12, unit: 'deg' }],
    });

    const peaks = groupFindings([...pitchExcursions, inDegrees])[0]?.peaks ?? [];
    const forLabel = peaks.filter((entry) => entry.label === 'Peak RMS tracking error');

    // Two units, two peaks. Collapsing them would rank 12 deg above 0.341 rad, which is backwards.
    expect(forLabel).toHaveLength(2);
    expect(forLabel.map((entry) => entry.unit).sort()).toEqual(['deg', 'rad']);
  });

  it('takes its time span from the evidence, not from the statements', () => {
    const group = groupFindings(pitchExcursions)[0];

    expect(group?.firstSeconds).toBe(10);
    expect(group?.lastSeconds).toBe(91.25);
  });

  it('reports no span when no evidence is time-bounded', () => {
    const eventOnly = createFinding({
      id: 'finding:event-only',
      ruleId: 'analysis:logged-error',
      ruleVersion: '1.0.0',
      statement: 'The firmware logged an error.',
      severity: 'ADVISORY',
      evidence: [{ kind: 'event', eventId: 'event:logged-error:0' }],
      producedAtUtc: PRODUCED_AT,
    });

    const group = groupFindings([eventOnly])[0];

    // Null, not 0. A window at zero would place the finding at the start of the flight.
    expect(group?.firstSeconds).toBeNull();
    expect(group?.lastSeconds).toBeNull();
  });
});

describe('the number a rollup must not invent', () => {
  it('states no total, and would be caught if it did', () => {
    // This check is only worth running if it can fail, so the tempting number is computed here:
    // "24 excursions totalling 87.3 s" is the one line a helpful rollup adds, and it is a quantity
    // no Finding asserts and no evidence supports. If total exceedance matters, it is an analysis
    // result and belongs in a rule that can carry evidence for it.
    const durations = pitchExcursions.flatMap((finding) =>
      finding.measurements.filter((m) => m.label === 'Exceedance duration').map((m) => m.value),
    );
    const total = durations.reduce((sum, value) => sum + value, 0);

    expect(durations).toHaveLength(3);
    expect(durations).not.toContain(total);

    const numbersInGroups = new Set<number>();
    const walk = (value: unknown): void => {
      if (typeof value === 'number') {
        numbersInGroups.add(value);
      } else if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(walk);
      }
    };
    // The group's own fields only — `findings` carries the originals, whose numbers are theirs.
    for (const group of groupFindings(pitchExcursions)) {
      walk({
        count: group.count,
        firstSeconds: group.firstSeconds,
        lastSeconds: group.lastSeconds,
        peaks: group.peaks,
      });
    }

    expect(numbersInGroups.has(total)).toBe(false);
  });

  it('counts a tally, which is the one arithmetic it may do', () => {
    const groups = groupFindings(pitchExcursions);

    expect(groups[0]?.count).toBe(groups[0]?.findings.length);
  });
});

describe('grouping is deterministic', () => {
  it('orders worst first, then most repeated, whatever order the findings arrive in', () => {
    const critical = excursion({
      index: 7,
      signalId: 'attitude.yaw',
      severity: 'CRITICAL',
      peak: 1.1,
      startSeconds: 5,
      durationSeconds: 1,
    });
    const findings = [...pitchExcursions, rollExcursion, critical];

    const forward = groupFindings(findings).map((group) => group.key);
    const reversed = groupFindings([...findings].reverse()).map((group) => group.key);

    expect(forward).toEqual(reversed);
    expect(forward[0]).toContain('CRITICAL');
    // WARNING groups follow, the three-strong pitch group ahead of the single roll one.
    expect(forward[1]).toContain('attitude.pitch');
    expect(forward[2]).toContain('attitude.roll');
  });
});

describe('over a real flight', () => {
  it('groups what the pipeline actually produced', async () => {
    const input = await inputFor('degraded-flight.bin');
    const groups = groupFindings(input.findings);

    expect(input.findings.length).toBeGreaterThan(0);
    // Every finding is accounted for exactly once — grouping partitions, it does not filter.
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(input.findings.length);
    expect(groups.flatMap((group) => [...group.findings])).toHaveLength(input.findings.length);
  });
});
