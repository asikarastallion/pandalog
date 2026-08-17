/**
 * The runtime guard — doc 03 §7, doc 04 §1 rule 10:
 *
 * > AI explains/summarizes/correlates/hypothesizes; it never invents measurements, timestamps,
 * > severity, pass/fail, or root cause.
 *
 * Doc 04 records that rule as checked by the `AiAnswer` type contract having "no field that
 * overrides a `VerificationOutcome` or fabricates a `Finding`". That is necessary and it is not
 * sufficient: every field of `AiAnswer` is free text, and an invented measurement inside a sentence
 * is exactly as wrong as one in a numeric field — more so, because it reads like prose an engineer
 * would trust.
 *
 * `@pandalog/reporting` faces the same rule and can satisfy it structurally, because it is code
 * that either does arithmetic or does not. Here the output is the adversary, so the identical check
 * has to run at **runtime, on every answer**: every number in a claim must already be in the
 * context, and every evidence reference must resolve to one the deterministic layers produced.
 *
 * Nothing is dropped silently. A rejected claim is removed from the answer and listed, because a
 * caller renders `facts` directly and an ungrounded sentence left in it is one an engineer reads.
 */
import { describe, expect, it } from 'vitest';

import { askAi } from '@pandalog/ai';

import { answerJson, clientReturning, contextFor } from './support/context.js';

const ask = async (context: Awaited<ReturnType<typeof contextFor>>, body: string) =>
  askAi(context, 'Why did this flight behave the way it did?', clientReturning(body));

describe('numbers in an answer', () => {
  it('keeps a claim whose numbers are all in the context', async () => {
    const context = await contextFor();
    const measurement = context.findings[0]?.measurements[0];
    if (measurement === undefined) {
      throw new Error('The fixture no longer produces a finding with a measurement.');
    }

    const grounded = await ask(
      context,
      answerJson({ facts: [`The peak was ${String(measurement.value)} ${measurement.unit}.`] }),
    );

    expect(grounded.answer.facts).toHaveLength(1);
    expect(grounded.rejected).toEqual([]);
  });

  it('rejects a claim carrying a measurement nothing produced', async () => {
    // The failure this exists for: a plausible, specific, entirely invented number. It is the most
    // damaging thing this layer can emit, because it is indistinguishable from a real one.
    const context = await contextFor();

    const grounded = await ask(
      context,
      answerJson({ facts: ['Peak vibration reached 91.7 m/s^2 during the excursion.'] }),
    );

    expect(grounded.answer.facts).toEqual([]);
    expect(grounded.rejected).toHaveLength(1);
    expect(grounded.rejected[0]?.reason).toMatch(/91\.7/);
  });

  it('rejects an invented number inside a hypothesis too', async () => {
    // A hypothesis may propose a new *explanation*; it may not propose a new measurement.
    const context = await contextFor();

    const grounded = await ask(
      context,
      answerJson({ hypotheses: ['A 23.4 Hz airframe resonance could explain the excursion.'] }),
    );

    expect(grounded.answer.hypotheses).toEqual([]);
    expect(grounded.rejected).toHaveLength(1);
  });

  it('keeps a hypothesis that proposes an explanation without inventing a number', async () => {
    const context = await contextFor();
    const statement =
      'A loose motor mount could explain both the vibration and the tracking error.';

    const grounded = await ask(context, answerJson({ hypotheses: [statement] }));

    expect(grounded.answer.hypotheses).toEqual([statement]);
  });

  it('allows a number that appears only inside a rule statement', async () => {
    // Rules write their own prose, and the numbers in it are analysis output. Treating only
    // numeric fields as grounded would reject the model for quoting the finding accurately.
    const context = await contextFor();
    const statement = context.findings[0]?.statement ?? '';
    const quoted = /\d+\.\d+/.exec(statement)?.[0];
    if (quoted === undefined) {
      throw new Error('The fixture no longer produces a finding with a number in its statement.');
    }

    const grounded = await ask(context, answerJson({ facts: [`The rule reported ${quoted}.`] }));

    expect(grounded.rejected).toEqual([]);
  });

  it('does not treat an identifier as an invented number', async () => {
    const context = await contextFor();
    const requirementId = context.outcomes[0]?.requirementId ?? '';

    const grounded = await ask(context, answerJson({ facts: [`${requirementId} was evaluated.`] }));

    expect(grounded.rejected).toEqual([]);
  });
});

describe('evidence references in an answer', () => {
  it('keeps a reference that resolves to evidence already in the context', async () => {
    const context = await contextFor();
    const reference = context.findings[0]?.evidence[0];
    if (reference === undefined) {
      throw new Error('The fixture no longer produces a finding with evidence.');
    }

    const grounded = await ask(context, answerJson({ evidenceRefs: [reference] }));

    expect(grounded.answer.evidenceRefs).toEqual([reference]);
    expect(grounded.rejected).toEqual([]);
  });

  it('rejects a reference to a signal window nobody recorded', async () => {
    const context = await contextFor();

    const grounded = await ask(
      context,
      answerJson({
        evidenceRefs: [
          {
            kind: 'signal-window',
            signalId: 'attitude.roll',
            t_start_seconds: 900,
            t_end_seconds: 910,
          },
        ],
      }),
    );

    expect(grounded.answer.evidenceRefs).toEqual([]);
    expect(grounded.rejected).toHaveLength(1);
    expect(grounded.rejected[0]?.field).toBe('evidenceRefs');
  });

  it('rejects a reference to an event that was never detected', async () => {
    const context = await contextFor();

    const grounded = await ask(
      context,
      answerJson({ evidenceRefs: [{ kind: 'event', eventId: 'invented:event@0.000000#0' }] }),
    );

    expect(grounded.answer.evidenceRefs).toEqual([]);
  });

  it('rejects a malformed reference rather than guessing what was meant', async () => {
    const context = await contextFor();

    const grounded = await ask(
      context,
      answerJson({ evidenceRefs: [{ kind: 'signal-window', signalId: 'attitude.roll' }] }),
    );

    expect(grounded.answer.evidenceRefs).toEqual([]);
    expect(grounded.rejected).toHaveLength(1);
  });
});

describe('verification outcomes in an answer', () => {
  it('rejects a claim that contradicts a recorded outcome', async () => {
    // The single most dangerous sentence this layer could produce: naming a requirement and
    // asserting the opposite of what the evaluator concluded (doc 04 §1 rule 10).
    const context = await contextFor();
    const failed = context.outcomes.find((outcome) => outcome.outcome === 'FAIL');
    if (failed === undefined) {
      throw new Error('The fixture no longer produces a FAIL.');
    }

    const grounded = await ask(
      context,
      answerJson({ facts: [`${failed.requirementId} PASS — the aircraft met the requirement.`] }),
    );

    expect(grounded.answer.facts).toEqual([]);
    expect(grounded.rejected[0]?.reason).toMatch(/FAIL/);
  });

  it('keeps a claim that restates the outcome correctly', async () => {
    const context = await contextFor();
    const failed = context.outcomes.find((outcome) => outcome.outcome === 'FAIL');
    if (failed === undefined) {
      throw new Error('The fixture no longer produces a FAIL.');
    }

    const grounded = await ask(
      context,
      answerJson({ facts: [`${failed.requirementId} was recorded FAIL.`] }),
    );

    expect(grounded.answer.facts).toHaveLength(1);
    expect(grounded.rejected).toEqual([]);
  });

  it('rejects a claim that upgrades an INCONCLUSIVE to a pass', async () => {
    const context = await contextFor('gps-glitch.bin');
    const open = context.outcomes.find((outcome) => outcome.outcome === 'INCONCLUSIVE');
    if (open === undefined) {
      throw new Error('The fixture no longer produces an INCONCLUSIVE.');
    }

    const grounded = await ask(
      context,
      answerJson({ facts: [`${open.requirementId} is effectively a PASS.`] }),
    );

    expect(grounded.answer.facts).toEqual([]);
  });
});

describe('what a rejection tells the caller', () => {
  it('names the field, the text and the reason', async () => {
    const context = await contextFor();

    const grounded = await ask(context, answerJson({ facts: ['Vibration hit 91.7 m/s^2.'] }));
    const [rejection] = grounded.rejected;

    expect(rejection?.field).toBe('facts');
    expect(rejection?.text).toBe('Vibration hit 91.7 m/s^2.');
    expect(rejection?.reason.length).toBeGreaterThan(0);
  });

  it('keeps the grounded parts of an answer whose other parts were rejected', async () => {
    // An answer is not all-or-nothing. Discarding a correct summary because one sentence was
    // ungrounded would push a caller toward turning the check off.
    const context = await contextFor();

    const grounded = await ask(
      context,
      answerJson({
        facts: ['The flight raised findings.', 'Vibration hit 91.7 m/s^2.'],
        recommendedChecks: ['Inspect the motor mounts.'],
      }),
    );

    expect(grounded.answer.facts).toEqual(['The flight raised findings.']);
    expect(grounded.answer.recommendedChecks).toEqual(['Inspect the motor mounts.']);
    expect(grounded.rejected).toHaveLength(1);
  });
});
