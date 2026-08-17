/**
 * Parsing what a model returns, and the shape it is allowed to return.
 *
 * A model's output is untrusted input in the same sense a flight log is (doc 04 §8), and it is
 * worse in one way: it is *designed* to be plausible. So nothing here repairs, infers or partially
 * accepts — a response that is not a well-formed answer is an error, never a half-answer that a
 * caller renders as though the model had said it.
 */
import { describe, expect, it } from 'vitest';

import { AiError, askAi, parseAnswer } from '@pandalog/ai';

import { answerJson, clientReturning, contextFor } from './support/context.js';

describe('parseAnswer', () => {
  it('accepts a well-formed answer', () => {
    const answer = parseAnswer(
      answerJson({ facts: ['A stated fact.'], recommendedChecks: ['A check.'] }),
    );

    expect(answer.facts).toEqual(['A stated fact.']);
    expect(answer.recommendedChecks).toEqual(['A check.']);
    expect(answer.hypotheses).toEqual([]);
  });

  it('accepts an answer wrapped in a fenced code block, which models routinely emit', () => {
    const answer = parseAnswer(
      `Here you go:\n\`\`\`json\n${answerJson({ facts: ['x'] })}\n\`\`\`\n`,
    );

    expect(answer.facts).toEqual(['x']);
  });

  it('refuses text that is not an answer at all', () => {
    expect(() => parseAnswer('I am sorry, I cannot help with that.')).toThrow(AiError);
  });

  it('refuses an answer whose fields are the wrong shape', () => {
    expect(() => parseAnswer(JSON.stringify({ facts: 'a single string' }))).toThrow(/facts/);
  });

  it('refuses an array containing something that is not a string', () => {
    expect(() =>
      parseAnswer(JSON.stringify({ ...JSON.parse(answerJson({})), facts: [1, 2] })),
    ).toThrow(AiError);
  });

  it('treats a missing field as empty rather than as an error', () => {
    // A model omitting `uncertainties` has said there are none it wishes to raise. That is a
    // legitimate answer, unlike a malformed one.
    const answer = parseAnswer(JSON.stringify({ facts: ['x'] }));

    expect(answer.uncertainties).toEqual([]);
    expect(answer.evidenceRefs).toEqual([]);
  });

  it('ignores fields it does not know, rather than failing on them', () => {
    const answer = parseAnswer(JSON.stringify({ facts: ['x'], severity: 'CRITICAL', score: 0.9 }));

    expect(answer.facts).toEqual(['x']);
    expect(Object.keys(answer).sort()).toEqual([
      'evidenceRefs',
      'facts',
      'hypotheses',
      'recommendedChecks',
      'uncertainties',
    ]);
  });

  it('carries a structured code, not just a message', () => {
    try {
      parseAnswer('not an answer');
      expect.unreachable('parseAnswer accepted text that was not an answer');
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).code).toBe('UNPARSEABLE_ANSWER');
    }
  });
});

describe('the answer type cannot override a deterministic result', () => {
  it('has no field for a severity, an outcome or a finding', async () => {
    // Doc 04 §1 rule 10, checked on the object a caller actually receives. A model that returns a
    // `severity` or an `outcome` gets it dropped at the boundary, not merely ignored downstream.
    const context = await contextFor();

    const grounded = await askAi(
      context,
      'Summarise the flight.',
      clientReturning(
        JSON.stringify({
          facts: [],
          hypotheses: [],
          uncertainties: [],
          evidenceRefs: [],
          recommendedChecks: [],
          severity: 'CRITICAL',
          outcome: 'PASS',
          finding: { id: 'ai:invented#0', statement: 'The AI decided this.' },
        }),
      ),
    );

    expect(Object.keys(grounded.answer).sort()).toEqual([
      'evidenceRefs',
      'facts',
      'hypotheses',
      'recommendedChecks',
      'uncertainties',
    ]);
    expect(JSON.stringify(grounded.answer)).not.toContain('CRITICAL');
  });

  it('records which model produced the answer, so it is attributable', async () => {
    const context = await contextFor();

    const grounded = await askAi(context, 'Summarise.', clientReturning(answerJson({})));

    expect(grounded.model).toBe('test-model');
  });

  it('propagates a client failure rather than returning an empty answer', async () => {
    // An empty answer is a legitimate model response. A failed call is not, and returning one as
    // the other would make an outage look like "the AI had nothing to add".
    const context = await contextFor();
    const failing = {
      model: 'test-model',
      complete: () => Promise.reject(new Error('network unreachable')),
    };

    await expect(askAi(context, 'Summarise.', failing)).rejects.toThrow(/network unreachable/);
  });
});
