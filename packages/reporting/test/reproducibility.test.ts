/**
 * Phase K acceptance — 05_IMPLEMENTATION_ROADMAP.md:
 *
 * > Two report-generation runs against the same dataset and versions produce identical report
 * > content (deep-equal on structured output; rendered-format diffs limited to non-substantive
 * > metadata like generation timestamp, which is itself logged separately from provenance).
 *
 * Two clocks are deliberately different in these tests. A reproducibility test that passes the same
 * `now` twice proves nothing about the timestamp being the *only* thing that may vary — it would
 * pass just as well for a report that embedded the clock in ten places.
 */
import { describe, expect, it } from 'vitest';

import { buildReport, renderMarkdown } from '@pandalog/reporting';

import { clockAt, comparingInput, inputFor } from './support/artifacts.js';

const EARLY = '2026-01-01T00:00:00.000Z';
const LATE = '2027-06-15T13:45:59.000Z';

describe('two runs against the same inputs', () => {
  it('produce deep-equal structured output when the clock is unchanged', async () => {
    const input = await inputFor('degraded-flight.bin');

    expect(buildReport(input)).toEqual(buildReport(input));
  });

  it('produce documents that differ only in the generation timestamp', async () => {
    const input = await inputFor('degraded-flight.bin');

    const first = buildReport({ ...input, now: clockAt(EARLY) });
    const second = buildReport({ ...input, now: clockAt(LATE) });

    expect(first.generatedAtUtc).toBe(EARLY);
    expect(second.generatedAtUtc).toBe(LATE);
    expect({ ...first, generatedAtUtc: null }).toEqual({ ...second, generatedAtUtc: null });
  });

  it('serialise to identical JSON once the timestamp is set aside', async () => {
    // Deep equality can be satisfied by objects that serialise differently — key order, a Map, a
    // typed array. A report is an archived artifact, so its bytes are what actually has to match.
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');

    const first = JSON.stringify(buildReport({ ...input, now: clockAt(EARLY) }));
    const second = JSON.stringify(buildReport({ ...input, now: clockAt(LATE) }));

    expect(first.replace(EARLY, '')).toBe(second.replace(LATE, ''));
  });

  it('render markdown whose only difference is the timestamp line', async () => {
    const input = await inputFor('degraded-flight.bin');

    const first = renderMarkdown(buildReport({ ...input, now: clockAt(EARLY) })).split('\n');
    const second = renderMarkdown(buildReport({ ...input, now: clockAt(LATE) })).split('\n');

    expect(first).toHaveLength(second.length);

    const differing = first
      .map((line, index) => ({ line, other: second[index] ?? '', index }))
      .filter((entry) => entry.line !== entry.other);

    expect(differing).toHaveLength(1);
    expect(differing[0]?.line).toContain(EARLY);
    expect(differing[0]?.other).toContain(LATE);
  });

  it('render markdown identically for a comparison report too', async () => {
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');

    const first = renderMarkdown(buildReport({ ...input, now: clockAt(EARLY) }));
    const second = renderMarkdown(buildReport({ ...input, now: clockAt(EARLY) }));

    expect(first).toBe(second);
  });
});

describe('reproducibility is not vacuous', () => {
  it('changes the report when the flight changes', async () => {
    // Guards the failure where a renderer emits a fixed skeleton: identical output for two runs
    // would be perfectly satisfied by a report that says nothing about the flight at all.
    const nominal = renderMarkdown(buildReport(await inputFor('nominal.bin')));
    const degraded = renderMarkdown(buildReport(await inputFor('degraded-flight.bin')));

    expect(nominal).not.toBe(degraded);
  });

  it('changes the report when a rule version changes', async () => {
    const input = await inputFor('degraded-flight.bin');
    const bumped = {
      ...input,
      executedRules: input.executedRules.map((rule) => ({ ...rule, version: '9.9.9' })),
    };

    expect(renderMarkdown(buildReport(input))).not.toBe(renderMarkdown(buildReport(bumped)));
  });

  it('changes the report when the source file hash changes', async () => {
    // The whole point of stamping a SHA-256 is that two reports over different bytes cannot look
    // the same. If this passes trivially, provenance is decorative.
    const input = await inputFor('degraded-flight.bin');
    const restamped = {
      ...input,
      dataset: {
        ...input.dataset,
        provenance: { ...input.dataset.provenance, sha256: 'f'.repeat(64) },
      },
    };

    expect(renderMarkdown(buildReport(input))).not.toBe(renderMarkdown(buildReport(restamped)));
  });
});
