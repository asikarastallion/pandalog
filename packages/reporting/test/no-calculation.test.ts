/**
 * The boundary doc 04 §7 draws: **reporting performs no calculation of its own.**
 *
 * > If a number appears in a report that isn't traceable to `analysis`/`verification`/`comparison`
 * > output, that's a boundary violation.
 *
 * A rule like that is normally enforced by code review and then quietly broken by a helpful
 * `.toFixed(1)` that grows into an average. These tests make it mechanical, in two ways:
 *
 *   1. **Traceability of the corpus.** Every number rendered as a *quantity* is checked against the
 *      numbers the artifacts actually contain, plus tallies of those artifacts. Anything left over
 *      is a number this package made up.
 *   2. **Perturbation.** Moving one measurement in the input must move the report. A renderer that
 *      recomputed a value, or cached one, would keep printing the old number.
 *
 * Test 1 leans on a convention the renderer holds to and `markdown.test.ts` pins: **identifiers go
 * in backticks, quantities do not.** Ids, hashes, versions and timestamps are full of digits that
 * are not measurements, and a check that could not tell them apart would either be unable to fail
 * or have to ignore so much that it stopped meaning anything.
 */
import { describe, expect, it } from 'vitest';

import { buildReport, renderMarkdown } from '@pandalog/reporting';

import { inputFor } from './support/artifacts.js';

/**
 * Every distinct number reachable in the artifacts, at full precision.
 *
 * Strings are mined too. A rule's own statement — "peak vibration reached 45.2 m/s^2" — is analysis
 * output, so the number inside it is as traceable as the `Measurement` beside it; treating only
 * numeric fields as sources would flag the report for repeating what the rule already said.
 */
function numbersIn(value: unknown, into = new Set<number>()): Set<number> {
  if (typeof value === 'number') {
    into.add(value);
  } else if (typeof value === 'string') {
    for (const match of value.matchAll(NUMERIC_TOKEN)) {
      into.add(Number(match[0]));
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      numbersIn(entry, into);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      numbersIn(entry, into);
    }
  }
  return into;
}

/**
 * A number in running text.
 *
 * The lookbehind keeps digits that are part of a word out of the corpus — "SHA-256" is a label, not
 * a quantity, and matching its tail would make the check fail on a report that invented nothing.
 * A genuine negative number still matches, because the match then begins at the minus sign itself
 * and what precedes it is whitespace.
 */
const NUMERIC_TOKEN = /(?<![A-Za-z\d-])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;

/** Strip everything that carries digits without being a quantity. */
const quantitiesOnly = (markdown: string): number[] =>
  [
    ...markdown
      .replace(/`[^`]*`/g, ' ') // identifiers, ids, hashes, versions, signal names
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, ' ') // ISO instants
      .matchAll(NUMERIC_TOKEN),
  ].map((match) => Number(match[0]));

describe('numbers rendered as quantities', () => {
  it('all trace back to the artifacts or to a tally of them', async () => {
    const input = await inputFor('degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    const sourceNumbers = numbersIn({
      findings: input.findings,
      hypotheses: input.hypotheses,
      verification: input.verification,
      provenance: input.dataset.provenance,
    });

    // Counting the very lists being rendered is rendering, not calculation.
    const largestTally = input.findings.length + input.verification.results.length;
    const tallies = new Set(Array.from({ length: largestTally + 1 }, (_unused, n) => n));

    const untraceable = quantitiesOnly(markdown).filter((value) => {
      if (tallies.has(value) || sourceNumbers.has(value)) {
        return false;
      }
      // A rendered value may be a rounded form of a source number — but only of one, and only
      // within half an ulp of the precision actually printed.
      const decimals = (String(value).split('.')[1] ?? '').length;
      const halfUlp = 0.5 * 10 ** -decimals;
      return ![...sourceNumbers].some((source) => Math.abs(source - value) <= halfUlp);
    });

    expect(untraceable).toEqual([]);
  });

  it('would notice a number the report invented', async () => {
    // The check above is only worth running if it can fail. An average of the measurements is the
    // exact kind of helpful calculation doc 04 §7 rules out, so it is computed here and confirmed
    // to be absent from the artifacts — which is what makes its absence from the report meaningful.
    const input = await inputFor('degraded-flight.bin');
    const measurements = input.findings.flatMap((finding) =>
      finding.measurements.map((entry) => entry.value),
    );
    expect(measurements.length).toBeGreaterThan(1);

    const mean = measurements.reduce((total, value) => total + value, 0) / measurements.length;
    const sourceNumbers = numbersIn(input.findings);

    expect(sourceNumbers.has(mean)).toBe(false);
    expect(quantitiesOnly(renderMarkdown(buildReport(input)))).not.toContain(mean);
  });
});

describe('a measurement that moves', () => {
  it('moves the report with it', async () => {
    const input = await inputFor('degraded-flight.bin');
    const [first, ...rest] = input.findings;
    const original = first?.measurements[0];
    if (first === undefined || original === undefined) {
      throw new Error('The fixture no longer produces a finding with a measurement.');
    }

    const moved = {
      ...first,
      measurements: [{ ...original, value: original.value + 12.5 }, ...first.measurements.slice(1)],
    };

    const before = quantitiesOnly(renderMarkdown(buildReport(input)));
    const after = quantitiesOnly(
      renderMarkdown(buildReport({ ...input, findings: [moved, ...rest] })),
    );

    expect(after).not.toEqual(before);
  });

  it('is kept at full precision in the structured document whatever the markdown prints', async () => {
    // A report is an archived record. If rounding to "30.1" were the only surviving trace, the
    // report could not reproduce the finding it reports.
    const input = await inputFor('degraded-flight.bin');
    const finding = input.findings.find((entry) => entry.measurements.length > 0);
    if (finding === undefined) {
      throw new Error('The fixture no longer produces a finding with a measurement.');
    }

    const document = buildReport(input);

    expect(document.findings.find((entry) => entry.id === finding.id)?.measurements).toEqual(
      finding.measurements,
    );
  });
});
