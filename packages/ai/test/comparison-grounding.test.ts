/**
 * Grounding across the rest of the evidence chain.
 *
 * The numbers an answer may quote do not all come from findings. A comparison's measured
 * differences, a hypothesis's statement and a verification reason are analysis output too, and a
 * guard that only knew about findings would reject the model for quoting them — which is how a
 * check that is too strict ends up switched off.
 *
 * The other half is ADR-0012 reaching this layer: an axis reported `INCOMPARABLE` was not compared,
 * and narrating it as agreement is the comparison-shaped version of inventing a pass.
 */
import { describe, expect, it } from 'vitest';

import { askAi, groundAnswer, renderContext, type AiAnswer } from '@pandalog/ai';

import { answerJson, clientReturning, comparingContext, contextFor } from './support/context.js';

describe('grounding against a comparison', () => {
  it('accepts a number the comparison measured', async () => {
    const context = await comparingContext();
    const difference = context.comparison?.signals.differences.find(
      (entry) => entry.aligned !== null,
    );
    const measured = difference?.aligned?.maxAbsoluteDifference;
    if (measured === undefined) {
      throw new Error('The fixtures no longer produce a time-aligned signal difference.');
    }

    const grounded = await askAi(
      context,
      'How far did it drift?',
      clientReturning(
        answerJson({ facts: [`The largest difference was ${String(measured)} on a signal.`] }),
      ),
    );

    expect(grounded.rejected).toEqual([]);
  });

  it('still rejects an invented number when a comparison is present', async () => {
    // The comparison widens what is grounded; it must not widen it to everything.
    const context = await comparingContext();

    const grounded = await askAi(
      context,
      'How far did it drift?',
      clientReturning(
        answerJson({ facts: ['The subject drifted 8123.77 further than baseline.'] }),
      ),
    );

    expect(grounded.answer.facts).toEqual([]);
    expect(grounded.rejected).toHaveLength(1);
  });

  it('tells the model that an incomparable axis is not an axis that agreed', async () => {
    const prompt = renderContext(await comparingContext());

    expect(prompt).toContain('COMPARISON AGAINST A BASELINE FLIGHT');
    expect(prompt).toMatch(/INCOMPARABLE was not compared/i);
  });

  it('renders every axis verdict, so the model cannot be unaware of one', async () => {
    const context = await comparingContext();
    const prompt = renderContext(context);

    expect(prompt).toContain(`- signals: ${context.comparison?.signals.verdict ?? ''}`);
    expect(prompt).toContain(`- verification: ${context.comparison?.verification.verdict ?? ''}`);
  });
});

describe('grounding against hypotheses already proposed', () => {
  it('accepts a number the analysis put in a hypothesis, and its evidence', async () => {
    const base = await contextFor();
    const finding = base.findings[0];
    const reference = finding?.evidence[0];
    if (finding === undefined || reference === undefined) {
      throw new Error('The fixture no longer produces a finding with evidence.');
    }

    const context = {
      ...base,
      hypotheses: [
        {
          id: 'hypothesis:mount#0',
          relatedFindingIds: [finding.id],
          statement: 'A mount resonance near 41.5 units could explain the excursion.',
          supportingEvidence: [reference],
          status: 'UNCONFIRMED' as const,
        },
      ],
    };

    const answer: AiAnswer = {
      facts: ['The analysis already proposed a mount resonance near 41.5 units.'],
      hypotheses: [],
      uncertainties: [],
      evidenceRefs: [reference],
      recommendedChecks: [],
    };

    const grounded = groundAnswer(answer, context, 'test-model');

    expect(grounded.rejected).toEqual([]);
    expect(grounded.answer.evidenceRefs).toEqual([reference]);
  });

  it('renders proposed hypotheses as unconfirmed in the prompt', async () => {
    const base = await contextFor();
    const context = {
      ...base,
      hypotheses: [
        {
          id: 'hypothesis:mount#0',
          relatedFindingIds: [],
          statement: 'A loose mount could explain it.',
          supportingEvidence: [],
          status: 'UNCONFIRMED' as const,
        },
      ],
    };

    expect(renderContext(context)).toContain('[UNCONFIRMED] A loose mount could explain it.');
  });
});

describe('how closely a quoted number must match', () => {
  it('accepts a value rounded to fewer digits than the measurement', async () => {
    // A model writing "0.175 rad" for a measured 0.174533 is restating it, not inventing it.
    const context = await contextFor();
    const measurement = context.findings[0]?.measurements[0];
    if (measurement === undefined) {
      throw new Error('The fixture no longer produces a measurement.');
    }
    const rounded = Number(measurement.value.toPrecision(3));
    expect(rounded).not.toBe(measurement.value);

    const grounded = groundAnswer(
      { ...EMPTY, facts: [`The peak was about ${String(rounded)} ${measurement.unit}.`] },
      context,
      'test-model',
    );

    expect(grounded.rejected).toEqual([]);
  });

  it('rejects a value that is merely in the same neighbourhood', async () => {
    const context = await contextFor();
    const measurement = context.findings[0]?.measurements[0];
    if (measurement === undefined) {
      throw new Error('The fixture no longer produces a measurement.');
    }

    const grounded = groundAnswer(
      { ...EMPTY, facts: [`The peak was ${String(measurement.value * 1.3)} ${measurement.unit}.`] },
      context,
      'test-model',
    );

    expect(grounded.rejected).toHaveLength(1);
  });
});

describe('an evidence reference of a kind that does not exist', () => {
  it('is rejected rather than treated as an unmatched one', async () => {
    const context = await contextFor();

    const grounded = groundAnswer(
      {
        ...EMPTY,
        evidenceRefs: [{ kind: 'root-cause', cause: 'motor failure' } as never],
      },
      context,
      'test-model',
    );

    expect(grounded.answer.evidenceRefs).toEqual([]);
    expect(grounded.rejected).toHaveLength(1);
  });
});

const EMPTY: AiAnswer = {
  facts: [],
  hypotheses: [],
  uncertainties: [],
  evidenceRefs: [],
  recommendedChecks: [],
};
