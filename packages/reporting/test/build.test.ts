/**
 * The report document — doc 04 §7.
 *
 * > `packages/reporting` renders structured artifacts (`Finding[]`, `VerificationResult[]`,
 * > comparison output); it performs no calculation of its own. If a number appears in a report
 * > that isn't traceable to `analysis`/`verification`/`comparison` output, that's a boundary
 * > violation.
 *
 * The document is built to make that rule structural rather than a habit: it *embeds the artifacts
 * unchanged* and adds provenance, an ordering and a tally. So "no number was invented" is not a
 * property somebody has to keep checking — it is deep-equality against the input, tested here.
 */
import { describe, expect, it } from 'vitest';

import { buildReport, REPORTING_VERSION } from '@pandalog/reporting';

import { clockAt, comparingInput, inputFor, NOW } from './support/artifacts.js';

describe('buildReport', () => {
  it('embeds the findings it was given, unchanged', async () => {
    const input = await inputFor('degraded-flight.bin');

    const document = buildReport(input);

    expect(document.findings).toEqual(input.findings);
    expect(document.hypotheses).toEqual(input.hypotheses);
  });

  it('embeds the verification report unchanged, outcome for outcome', async () => {
    const input = await inputFor('degraded-flight.bin');

    const document = buildReport(input);

    expect(document.verification).toEqual(input.verification);
    expect(document.verification.results.length).toBeGreaterThan(0);
  });

  it('embeds the comparison unchanged when there is one', async () => {
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');

    const document = buildReport(input);

    expect(document.comparison).toEqual(input.comparison);
  });

  it('carries a null comparison rather than an empty one for a single-flight report', async () => {
    // An empty comparison object would render as a comparison that found nothing, which is a
    // different statement from "this report is about one flight".
    const document = buildReport(await inputFor('nominal.bin'));

    expect(document.comparison).toBeNull();
  });

  it('keeps the generation timestamp out of provenance', async () => {
    // Phase K acceptance treats the generation time as non-substantive metadata, which it can only
    // be if it is not mixed into the provenance a reader uses to reproduce the run. The report is
    // generated on a different clock from the one that ingested the log, because with a single
    // clock this test would pass without distinguishing the two — and `ingestedAtUtc` is a
    // timestamp that *does* belong in provenance.
    const printed = '2027-06-15T13:45:59.000Z';
    const document = buildReport(await inputFor('nominal.bin', { now: clockAt(printed) }));

    expect(document.generatedAtUtc).toBe(printed);
    expect(document.provenance.source.ingestedAtUtc).toBe(NOW);
    expect(JSON.stringify(document.provenance)).not.toContain(printed);
  });

  it('freezes the document, so a report cannot be edited after it is produced', async () => {
    const document = buildReport(await inputFor('nominal.bin'));

    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.provenance)).toBe(true);
  });
});

describe('report provenance', () => {
  it('carries every field doc 04 §7 requires', async () => {
    const input = await inputFor('degraded-flight.bin');

    const { provenance } = buildReport(input);

    expect(provenance.source.sha256).toBe(input.dataset.provenance.sha256);
    expect(provenance.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.source.parserPackage).toBe('@pandalog/parser-ardupilot');
    expect(provenance.source.parserVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(provenance.schemaVersion).toBe(input.dataset.schemaVersion);
    expect(provenance.reportingVersion).toBe(REPORTING_VERSION);
    expect(provenance.requirementSet.id).toBe(input.verification.requirementSetId);
    expect(provenance.requirementSet.version).toBe(input.verification.requirementSetVersion);
  });

  it('names every rule the flight was checked against, with its version', async () => {
    const input = await inputFor('degraded-flight.bin');

    const { provenance } = buildReport(input);

    expect(provenance.rules).toEqual(input.executedRules);
    expect(provenance.rules.length).toBeGreaterThan(0);
    for (const rule of provenance.rules) {
      expect(rule.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('records the comparison tolerances a comparison was judged under', async () => {
    const input = await comparingInput('nominal.bin', 'degraded-flight.bin');

    const { provenance } = buildReport(input);

    expect(provenance.comparisonTolerances).toEqual(input.comparison?.tolerances);
    expect(provenance.comparisonTolerances?.every((t) => t.basis.length > 0)).toBe(true);
  });

  it('leaves comparison tolerances null when nothing was compared', async () => {
    const { provenance } = buildReport(await inputFor('nominal.bin'));

    expect(provenance.comparisonTolerances).toBeNull();
  });

  it('carries the vehicle as logged, without filling in what the log did not say', async () => {
    const input = await inputFor('nominal.bin');

    const { provenance } = buildReport(input);

    expect(provenance.vehicle).toEqual(input.dataset.vehicle);
  });
});

describe('report counts', () => {
  it('tallies findings by severity', async () => {
    const input = await inputFor('degraded-flight.bin');

    const { counts } = buildReport(input);

    for (const severity of ['INFO', 'ADVISORY', 'WARNING', 'CRITICAL'] as const) {
      expect(counts.findingsBySeverity[severity]).toBe(
        input.findings.filter((finding) => finding.severity === severity).length,
      );
    }
    expect(counts.findings).toBe(input.findings.length);
  });

  it('reuses the verification summary rather than recounting it', async () => {
    // Recounting would be a second implementation of the same tally, and two implementations of
    // one number is how a report starts disagreeing with the result it reports.
    const input = await inputFor('degraded-flight.bin');

    const document = buildReport(input);

    expect(document.counts.outcomes).toBe(input.verification.summary);
  });

  it('counts a flight that produced no findings as none, not as absent', async () => {
    const input = await inputFor('nominal.bin', { findings: [], hypotheses: [] });

    const { counts } = buildReport(input);

    expect(counts.findings).toBe(0);
    expect(counts.findingsBySeverity.CRITICAL).toBe(0);
  });
});
