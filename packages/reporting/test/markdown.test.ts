/**
 * The rendered report.
 *
 * Markdown because a report is an archived artifact: it diffs in review, reads without a tool, and
 * needs no dependency to produce. What is tested here is not layout but the handful of things a
 * renderer can quietly get wrong in a way that changes what the report *asserts*.
 */
import { createFinding, type Finding } from '@pandalog/analysis';
import { describe, expect, it } from 'vitest';

import { buildReport, renderMarkdown } from '@pandalog/reporting';

import { comparingInput, inputFor } from './support/artifacts.js';

const render = async (name: string) => renderMarkdown(buildReport(await inputFor(name)));

describe('renderMarkdown', () => {
  it('leads with the source file and its hash, so the report names what it is about', async () => {
    const input = await inputFor('degraded-flight.bin');

    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toContain('degraded-flight.bin');
    expect(markdown).toContain(input.dataset.provenance.sha256);
  });

  it('shows every verification outcome as itself, not folded into pass or fail', async () => {
    // The same refusal apps/web makes (doc 03 §3): INCONCLUSIVE and NOT_APPLICABLE are answers,
    // and a report that renders four outcomes as two ticks is asserting more than it was told.
    const input = await inputFor('degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    for (const result of input.verification.results) {
      expect(markdown).toContain(result.outcome);
    }
  });

  it('prints the reason behind every outcome', async () => {
    const input = await inputFor('degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    for (const result of input.verification.results) {
      expect(markdown).toContain(result.reason);
    }
  });

  it('states the basis of every threshold it prints', async () => {
    // Doc 03 §4. A threshold in a report without its basis reads as a settled criterion, and every
    // threshold in this repository is provisional.
    const input = await inputFor('degraded-flight.bin');
    const thresholds = input.findings.flatMap((finding) => finding.thresholds);
    expect(thresholds.length).toBeGreaterThan(0);

    const markdown = renderMarkdown(buildReport(input));

    for (const threshold of thresholds) {
      expect(markdown).toContain(threshold.basis);
    }
  });

  it('cites the evidence behind each finding rather than the claim alone', async () => {
    const input = await inputFor('degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    const windows = input.findings
      .flatMap((finding) => finding.evidence)
      .filter((reference) => reference.kind === 'signal-window');
    expect(windows.length).toBeGreaterThan(0);

    for (const reference of windows) {
      expect(markdown).toContain(reference.signalId);
    }
  });

  it('marks a hypothesis as unconfirmed wherever it appears', async () => {
    const input = await inputFor('degraded-flight.bin');
    if (input.hypotheses.length === 0) {
      return;
    }

    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toContain('UNCONFIRMED');
  });

  it('names the rules the flight was checked against, including the silent ones', async () => {
    const input = await inputFor('nominal.bin');
    const markdown = renderMarkdown(buildReport(input));

    for (const rule of input.executedRules) {
      expect(markdown).toContain(rule.id);
    }
  });

  it('says a flight raised no findings rather than printing an empty section', async () => {
    const input = await inputFor('nominal.bin', { findings: [], hypotheses: [] });

    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toMatch(/no findings/i);
  });

  it('keeps identifiers in backticks and quantities out of them', async () => {
    // The convention `no-calculation.test.ts` relies on to tell a measurement from an id.
    const input = await inputFor('degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toContain(`\`${input.dataset.provenance.sha256}\``);
    for (const finding of input.findings) {
      expect(markdown).toContain(`\`${finding.ruleId}\``);
    }
  });

  it('names a quantity it was handed as absent rather than printing zero', async () => {
    // `ReportInput` is an interface, so a caller can hand this package an object literal that
    // never went through `createFinding` — which is exactly how `@pandalog/verification` treats
    // the results it receives. A NaN reaching the renderer must not be printed as 0 (doc 04 §1
    // rule 6): a report saying a peak was 0 m/s^2 asserts a measurement nobody took.
    const input = await inputFor('degraded-flight.bin');
    const unvalidated: Finding = {
      id: 'foreign:finding#0',
      ruleId: 'foreign:rule',
      ruleVersion: '1.0.0',
      statement: 'A rule from outside this repository reported a quantity it did not have.',
      severity: 'ADVISORY',
      evidence: [{ kind: 'event', eventId: 'foreign:event#0' }],
      measurements: [{ label: 'Peak', value: Number.NaN, unit: 'm/s^2' }],
      thresholds: [],
      producedAtUtc: '2026-01-01T00:00:00.000Z',
    };

    const markdown = renderMarkdown(buildReport({ ...input, findings: [unvalidated] }));

    expect(markdown).toContain('Peak: not recorded m/s^2');
    expect(markdown).not.toContain('Peak: 0 m/s^2');
    expect(markdown).not.toContain('Peak: NaN');
  });

  it('prints the vehicle the log identified, and says so when it did not', async () => {
    const input = await inputFor('nominal.bin');
    const identified = {
      ...input,
      dataset: {
        ...input.dataset,
        vehicle: { frameClass: 'quad', firmwareVersion: 'ArduCopter 4.5.7', firmwareHash: null },
      },
    };

    const markdown = renderMarkdown(buildReport(identified));

    expect(markdown).toContain('`quad`');
    expect(markdown).toContain('`ArduCopter 4.5.7`');
    // The one field the log did not carry is named as absent, not left as an empty cell that reads
    // as though nobody asked (doc 04 §1 rule 6).
    expect(markdown).toContain('| Firmware hash | not logged |');
  });

  it('ends with a single trailing newline, so the file diffs cleanly', async () => {
    const markdown = await render('nominal.bin');

    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
  });
});

describe('rendering a comparison', () => {
  it('shows all three verdict states rather than a pass/fail pair (ADR-0012)', async () => {
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toContain('DIFFERENT');
    // The axis verdicts are what a reader scans; each is printed as the word the comparison used.
    for (const axis of ['Signals', 'Events', 'Findings', 'Verification']) {
      expect(markdown).toContain(axis);
    }
  });

  it('names the flights being compared', async () => {
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toContain('nominal.bin');
    expect(markdown).toContain('degraded-flight.bin');
  });

  it('reports the requirements that regressed', async () => {
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');
    const regressions = input.comparison?.verification.regressions ?? [];
    expect(regressions.length).toBeGreaterThan(0);

    const markdown = renderMarkdown(buildReport(input));

    for (const requirementId of regressions) {
      expect(markdown).toContain(requirementId);
    }
  });

  it('carries the time-alignment caveat into the report', async () => {
    // A cross-flight comparison rests on elapsed-time alignment, and the report is where that
    // assumption has to be visible — a reader cannot check it against a note in the source.
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');
    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toMatch(/elapsed/i);
  });

  it('names the signals a comparison could not examine (ADR-0012)', async () => {
    // gps-glitch.bin carries three vibration signals with nothing usable in them. The axis verdict
    // is SAME, and a SAME beside three unexaminable signals is a weaker statement than a SAME
    // beside none — so the report prints them rather than leaving a reader to infer it.
    const input = await comparingInput('gps-glitch.bin', 'gps-glitch.bin');
    expect(input.comparison?.signals.incomparable.length).toBeGreaterThan(0);

    const markdown = renderMarkdown(buildReport(input));

    expect(markdown).toContain('Signals that could not be compared');
    for (const signalId of input.comparison?.signals.incomparable ?? []) {
      expect(markdown).toContain(`\`${signalId}\``);
    }
  });

  it('omits the comparison section entirely for a single-flight report', async () => {
    const markdown = await render('nominal.bin');

    expect(markdown).not.toMatch(/^## Comparison/m);
  });
});

/**
 * The report the grouping exists for.
 *
 * A real log put 43 findings through this renderer, of which twenty-odd were one rule restating one
 * sentence with different numbers, and the result was 1295 lines of prose nobody reads. These
 * assertions are about that report, not the three-finding fixture: they build the repetition
 * deliberately, because a fixture that never repeats cannot show whether the fix works.
 */
describe('a rule that fired many times', () => {
  const repeated = (index: number, peak: number, start: number, duration: number): Finding =>
    createFinding({
      id: `finding:pitch:${String(index)}`,
      ruleId: 'analysis:attitude-tracking-error',
      ruleVersion: '1.0.0',
      statement: `Pitch tracking exceeded the configured criterion for ${String(duration)} s.`,
      severity: 'WARNING',
      evidence: [
        {
          kind: 'signal-window',
          signalId: 'attitude.pitch',
          t_start_seconds: start,
          t_end_seconds: start + duration,
        },
      ],
      measurements: [{ label: 'Peak RMS tracking error', value: peak, unit: 'rad' }],
      thresholds: [
        { label: 'RMS tracking error criterion', value: 0.0873, unit: 'rad', basis: 'provisional' },
      ],
      producedAtUtc: '2026-01-01T00:00:00.000Z',
    });

  const twentyFour = Array.from({ length: 24 }, (_unused, index) =>
    repeated(index, 0.1 + index / 100, index * 30, 1 + (index % 4)),
  );

  const renderRepeated = async (): Promise<string> => {
    const input = await inputFor('degraded-flight.bin', { findings: twentyFour });
    return renderMarkdown(buildReport(input));
  };

  it('states the repetition once instead of leaving it to be counted', async () => {
    const markdown = await renderRepeated();

    expect(markdown).toContain('24 occurrences');
    // Index row: one line standing for all twenty-four.
    expect(markdown).toContain('| `analysis:attitude-tracking-error` | WARNING |');
  });

  it('reports the largest value any occurrence recorded, and says which one', async () => {
    const markdown = await renderRepeated();

    // 0.1 + 23/100 — the last occurrence's own measurement, selected rather than derived.
    expect(markdown).toContain('Peak RMS tracking error: 0.33 rad (finding `finding:pitch:23`)');
  });

  it('states the shared criterion once rather than twenty-four times', async () => {
    const markdown = await renderRepeated();
    const criterionLines = markdown
      .split('\n')
      .filter((line) => line.startsWith('- RMS tracking error criterion:'));

    expect(criterionLines).toHaveLength(1);
    expect(markdown).toContain('Thresholds, identical for every occurrence below:');
  });

  it('still prints every occurrence with its own evidence', async () => {
    // The grouping must not be a summary that replaces the findings. Each of the 24 is a separate
    // evidenced claim (doc 03 §3) and all 24 remain auditable in the document.
    const markdown = await renderRepeated();

    for (const finding of twentyFour) {
      expect(markdown, `${finding.id} is missing from the report`).toContain(finding.id);
    }
    // One occurrence heading per finding — the group did not swallow any of them.
    expect(markdown.split('\n').filter((line) => line.startsWith('#### t ='))).toHaveLength(24);
  });

  it('prints no total across the occurrences', async () => {
    const markdown = await renderRepeated();
    const total = twentyFour.reduce(
      (sum, finding) => sum + (finding.measurements[0]?.value ?? 0),
      0,
    );

    // The one number a rollup is tempted to add. It is not in the artifacts, so it is not in the
    // report — see rollup.ts for why it would belong in @pandalog/analysis if it were wanted.
    expect(markdown).not.toContain(String(total));
    expect(markdown).not.toContain(String(Number.parseFloat(total.toPrecision(6))));
  });

  it('states a shared criterion once where repeating it would cost 23 blocks', async () => {
    // A differential test rather than a line-count guess. The same 24 findings are rendered twice:
    // once judged against one criterion, once against 24 subtly different ones. Only the first can
    // hoist, so the difference between them is exactly what hoisting saves — and it is measured
    // rather than asserted from a number somebody picked.
    const shared = await renderRepeated();

    const perOccurrenceCriteria = twentyFour.map((finding, index) =>
      createFinding({
        ...finding,
        thresholds: [
          {
            label: 'RMS tracking error criterion',
            value: 0.0873 + index / 1000,
            unit: 'rad',
            basis: 'provisional',
          },
        ],
      }),
    );
    const unshared = renderMarkdown(
      buildReport(await inputFor('degraded-flight.bin', { findings: perOccurrenceCriteria })),
    );

    const lines = (markdown: string): number => markdown.split('\n').length;

    expect(lines(shared)).toBeLessThan(lines(unshared));
    expect(lines(unshared) - lines(shared)).toBe(23 * 4);
  });
});
