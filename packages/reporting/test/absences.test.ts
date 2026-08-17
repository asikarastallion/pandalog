/**
 * What a report says when there is nothing to say.
 *
 * Every path here is one where a renderer can be silent and look correct: no hypotheses, no
 * requirements, no rules, a requirement that claimed more than it showed. Silence and absence read
 * identically in a finished document, so each of these is rendered as an explicit sentence and
 * each of those sentences is pinned here.
 */
import { createHypothesis, type Hypothesis } from '@pandalog/analysis';
import { describe, expect, it } from 'vitest';
import type { VerificationReport } from '@pandalog/verification';

import { buildReport, ReportingError, renderMarkdown } from '@pandalog/reporting';

import { clockAt, inputFor } from './support/artifacts.js';

describe('a report with parts missing', () => {
  it('renders hypotheses as unconfirmed, with what they relate to', async () => {
    const input = await inputFor('degraded-flight.bin');
    const hypothesis: Hypothesis = createHypothesis({
      id: 'hypothesis:vibration-mount#0',
      relatedFindingIds: [input.findings[0]?.id ?? 'unknown'],
      statement: 'The vibration excursion may share a cause with the attitude tracking error.',
      supportingEvidence: [
        { kind: 'signal-window', signalId: 'vibration.x', t_start_seconds: 1, t_end_seconds: 3 },
      ],
    });

    const markdown = renderMarkdown(buildReport({ ...input, hypotheses: [hypothesis] }));

    expect(markdown).toContain('## Hypotheses');
    expect(markdown).toContain('UNCONFIRMED');
    expect(markdown).toContain(hypothesis.statement);
    // Doc 03 §1: a hypothesis must not read as a finding. The section says so in words, because a
    // reader skimming headings will not infer it from the type name.
    expect(markdown).toMatch(/none of these is established by its evidence/i);
  });

  it('says a hypothesis relates to nothing rather than printing an empty list', async () => {
    // `createHypothesis` rejects this — doc 03 §1: a speculation with nothing to explain is not a
    // hypothesis about this flight. It is built as a literal here for the same reason the NaN
    // measurement is: `ReportInput` is an interface, and a caller outside this repository can hand
    // over anything at all.
    const input = await inputFor('nominal.bin');
    const unattached: Hypothesis = {
      id: 'hypothesis:unattached#0',
      relatedFindingIds: [],
      statement: 'An explanation with no finding attached to it yet.',
      supportingEvidence: [],
      status: 'UNCONFIRMED',
    };

    const markdown = renderMarkdown(buildReport({ ...input, hypotheses: [unattached] }));

    expect(markdown).toContain('Related findings: none');
  });

  it('says no requirements were evaluated rather than showing an empty verification', async () => {
    const input = await inputFor('nominal.bin');
    const empty: VerificationReport = { ...input.verification, results: [] };

    const markdown = renderMarkdown(buildReport({ ...input, verification: empty }));

    expect(markdown).toMatch(/no requirements were evaluated/i);
  });

  it('says no rules were registered rather than showing an empty table', async () => {
    const input = await inputFor('nominal.bin');

    const markdown = renderMarkdown(buildReport({ ...input, executedRules: [] }));

    expect(markdown).toMatch(/no analysis rules were registered/i);
  });

  it('names requirements that claimed more than they showed', async () => {
    // Doc 03 §3: such a result was recorded INCONCLUSIVE to protect the report, but the
    // implementation is defective and a report that hid that would only move the problem.
    const input = await inputFor('nominal.bin');
    const withViolation: VerificationReport = {
      ...input.verification,
      evidenceRuleViolations: ['REQ-FOREIGN-001'],
    };

    const markdown = renderMarkdown(buildReport({ ...input, verification: withViolation }));

    expect(markdown).toContain('Requirements that claimed more than they showed');
    expect(markdown).toContain('REQ-FOREIGN-001');
  });

  it('omits that section entirely when no requirement over-claimed', async () => {
    const markdown = renderMarkdown(buildReport(await inputFor('nominal.bin')));

    expect(markdown).not.toContain('claimed more than they showed');
  });
});

describe('a clock that cannot stamp a report', () => {
  it('is refused rather than producing a report stamped Invalid Date', async () => {
    // A report stamped `Invalid Date` is worse than one that failed to generate: it looks filed.
    const input = await inputFor('nominal.bin');

    expect(() => buildReport({ ...input, now: () => new Date('not a date') })).toThrow(
      ReportingError,
    );
  });

  it('carries a structured code, not just a message', async () => {
    const input = await inputFor('nominal.bin');

    try {
      buildReport({ ...input, now: () => new Date(Number.NaN) });
      expect.unreachable('buildReport accepted an unusable clock');
    } catch (error) {
      expect(error).toBeInstanceOf(ReportingError);
      expect((error as ReportingError).code).toBe('INVALID_INPUT');
    }
  });

  it('accepts a clock at any valid instant', async () => {
    const input = await inputFor('nominal.bin');

    expect(buildReport({ ...input, now: clockAt('1999-12-31T23:59:59.999Z') }).generatedAtUtc).toBe(
      '1999-12-31T23:59:59.999Z',
    );
  });
});
