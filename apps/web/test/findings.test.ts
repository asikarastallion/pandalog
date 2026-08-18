/**
 * Filtering, searching and grouping the findings list.
 *
 * The list this replaces was a flat `v-for` over every finding. On a real log that was 43 rows,
 * twenty-odd of them one rule restating one sentence — a list nobody reads, which is a different
 * failure from a list that is wrong but not a smaller one: an unread finding and an absent finding
 * inform an engineer equally.
 *
 * These run against real fixture output and against constructed repetition, because the committed
 * fixtures raise one finding per rule and so cannot show whether grouping does anything.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFinding, type Finding } from '@pandalog/analysis';
import { runPipeline, type PipelineResult } from '@pandalog/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  browseFindings,
  NO_FILTER,
  toggleRuleId,
  toggleSeverity,
  withQuery,
} from '../src/workspace/findings.js';
import { findingsByTime } from '../src/workspace/investigation.js';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'ardupilot',
);

const load = (name: string): Promise<PipelineResult> =>
  runPipeline({
    fileName: name,
    bytes: new Uint8Array(readFileSync(path.join(FIXTURES, name))),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

const excursion = (index: number, signalId: string, severity: Finding['severity']): Finding =>
  createFinding({
    id: `finding:${signalId}:${String(index)}`,
    ruleId: 'analysis:attitude-tracking-error',
    ruleVersion: '1.0.0',
    statement: `${signalId} tracking exceeded the configured criterion.`,
    severity,
    evidence: [
      {
        kind: 'signal-window',
        signalId,
        t_start_seconds: index * 10,
        t_end_seconds: index * 10 + 2,
      },
    ],
    measurements: [{ label: 'Peak RMS tracking error', value: 0.1 + index / 100, unit: 'rad' }],
    producedAtUtc: '2026-01-01T00:00:00.000Z',
  });

const pitch = Array.from({ length: 24 }, (_unused, index) =>
  excursion(index, 'attitude.pitch', 'WARNING'),
);
const roll = [excursion(0, 'attitude.roll', 'CRITICAL')];
const entries = findingsByTime([...pitch, ...roll]);

describe('grouping the list', () => {
  it('turns 24 repetitions into one group that still holds all 24', () => {
    const browse = browseFindings(entries);

    expect(browse.totalCount).toBe(25);
    expect(browse.groups).toHaveLength(2);
    expect(browse.groups.reduce((sum, view) => sum + view.entries.length, 0)).toBe(25);
  });

  it('orders each group by time, so a group reads as a sequence of events', () => {
    const view = browseFindings(entries).groups.find((entry) => entry.group.count === 24);
    const times = view?.entries.map((entry) => entry.startSeconds) ?? [];

    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(0);
  });

  it('puts the worst group first', () => {
    expect(browseFindings(entries).groups[0]?.group.severity).toBe('CRITICAL');
  });

  it('groups exactly as the report does, so screen and document cannot disagree', async () => {
    // Not an implementation detail: an engineer who finds something on screen goes looking for it
    // in the report, and two grouping rules would send them to a different shape.
    const { groupFindings } = await import('@pandalog/reporting');
    const browse = browseFindings(entries);

    expect(browse.groups.map((view) => view.group.key)).toEqual(
      groupFindings(entries.map((entry) => entry.finding)).map((group) => group.key),
    );
  });
});

describe('filtering never lies about what it is hiding', () => {
  it('reports matched and total separately', () => {
    const browse = browseFindings(entries, toggleSeverity(NO_FILTER, 'CRITICAL'));

    expect(browse.matchCount).toBe(1);
    expect(browse.totalCount).toBe(25);
    expect(browse.isFiltered).toBe(true);
  });

  it('is not filtered when nothing is hidden', () => {
    expect(browseFindings(entries).isFiltered).toBe(false);
    expect(browseFindings(entries, withQuery(NO_FILTER, '   ')).isFiltered).toBe(false);
  });

  it('counts a group by what the filter left, not by what the rule raised', () => {
    // A heading reading "24 occurrences" above three visible rows would be a count of something
    // the reader cannot see.
    const browse = browseFindings(entries, withQuery(NO_FILTER, 'attitude.roll'));

    expect(browse.groups).toHaveLength(1);
    expect(browse.groups[0]?.group.count).toBe(1);
    expect(browse.groups[0]?.entries).toHaveLength(1);
  });

  it('treats an empty severity list as every severity rather than none', () => {
    expect(browseFindings(entries, NO_FILTER).matchCount).toBe(25);
  });
});

describe('searching', () => {
  it('matches a cited signal id', () => {
    expect(browseFindings(entries, withQuery(NO_FILTER, 'attitude.pitch')).matchCount).toBe(24);
  });

  it('matches a severity and a rule id', () => {
    expect(browseFindings(entries, withQuery(NO_FILTER, 'critical')).matchCount).toBe(1);
    expect(browseFindings(entries, withQuery(NO_FILTER, 'tracking-error')).matchCount).toBe(25);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(browseFindings(entries, withQuery(NO_FILTER, '  ATTITUDE.ROLL ')).matchCount).toBe(1);
  });

  it('returns nothing, visibly, when nothing matches', () => {
    const browse = browseFindings(entries, withQuery(NO_FILTER, 'no such signal'));

    expect(browse.groups).toEqual([]);
    expect(browse.matchCount).toBe(0);
    expect(browse.totalCount).toBe(25);
  });

  it('does not match a measurement value, which is a different question', () => {
    // Searching "0.1" should not surface every finding whose peak happens to contain those digits;
    // that is a numeric query, and answering it with a substring match would be answering wrongly.
    expect(browseFindings(entries, withQuery(NO_FILTER, '0.15')).matchCount).toBe(0);
  });
});

describe('the filter is a value, not a mutation', () => {
  it('returns a new filter and leaves the old one alone', () => {
    const toggled = toggleSeverity(NO_FILTER, 'WARNING');

    expect(NO_FILTER.severities).toEqual([]);
    expect(toggled.severities).toEqual(['WARNING']);
    expect(toggleSeverity(toggled, 'WARNING').severities).toEqual([]);
  });

  it('toggles rule ids the same way', () => {
    const on = toggleRuleId(NO_FILTER, 'analysis:vibration-level');

    expect(on.ruleIds).toEqual(['analysis:vibration-level']);
    expect(toggleRuleId(on, 'analysis:vibration-level').ruleIds).toEqual([]);
  });
});

describe('against real fixture data (degraded-flight.bin)', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await load('degraded-flight.bin');
  });

  it('accounts for every finding the pipeline produced', () => {
    const browse = browseFindings(findingsByTime(result.findings));

    expect(result.findings.length).toBeGreaterThan(0);
    expect(browse.totalCount).toBe(result.findings.length);
    expect(browse.groups.reduce((sum, view) => sum + view.entries.length, 0)).toBe(
      result.findings.length,
    );
  });

  it('offers only filter options the flight actually contains', () => {
    const browse = browseFindings(findingsByTime(result.findings));

    for (const ruleId of browse.availableRuleIds) {
      expect(result.findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
    }
    for (const severity of browse.availableSeverities) {
      expect(result.findings.some((finding) => finding.severity === severity)).toBe(true);
    }
  });
});
