/**
 * What the model is allowed to see — doc 03 §7:
 *
 * > `packages/ai` consumes `Finding[]`, `Hypothesis[]`, `VerificationResult[]` — it does not
 * > receive raw signals directly.
 *
 * Enforced by the shape of `AiContext` rather than by remembering not to pass a dataset: there is
 * no field for one. The prompt tests exist because the type only governs the object — the string
 * actually sent is where a signal, a file name or a hash could still leak.
 */
import { describe, expect, it } from 'vitest';

import { buildAiContext, renderContext } from '@pandalog/ai';

import { comparingContext, contextFor, runFixture } from './support/context.js';

describe('buildAiContext', () => {
  it('carries the findings, hypotheses and outcomes the deterministic layers produced', async () => {
    const result = await runFixture('degraded-flight.bin');

    const context = buildAiContext(result);

    expect(context.findings).toEqual(result.findings);
    expect(context.hypotheses).toEqual(result.hypotheses);
    expect(context.outcomes).toEqual(result.verification.results);
  });

  it('has nowhere to put a signal', async () => {
    // The structural half of doc 03 §7. A dataset passed in is ignored because there is no field
    // for it, so a future caller cannot widen the AI's view by accident.
    const result = await runFixture('degraded-flight.bin');

    const context = buildAiContext(result);

    expect(Object.keys(context)).not.toContain('dataset');
    expect(Object.keys(context)).not.toContain('signals');
    expect(JSON.stringify(context)).not.toContain('t_rel_seconds');
  });

  it('carries a comparison when there was one, and null when there was not', async () => {
    const single = await contextFor();
    const compared = await comparingContext();

    expect(single.comparison).toBeNull();
    expect(compared.comparison?.verdict).toBe('DIFFERENT');
  });
});

describe('renderContext', () => {
  it('states every finding, with its severity and evidence', async () => {
    const context = await contextFor();
    const prompt = renderContext(context);

    for (const finding of context.findings) {
      expect(prompt).toContain(finding.ruleId);
      expect(prompt).toContain(finding.severity);
      expect(prompt).toContain(finding.statement);
    }
  });

  it('states every verification outcome, so the model cannot be unaware of one', async () => {
    const context = await contextFor();
    const prompt = renderContext(context);

    for (const outcome of context.outcomes) {
      expect(prompt).toContain(outcome.requirementId);
      expect(prompt).toContain(outcome.outcome);
    }
  });

  it('tells the model what it is not permitted to do', async () => {
    const prompt = renderContext(await contextFor());

    expect(prompt).toMatch(/must not/i);
    expect(prompt).toMatch(/invent|fabricat/i);
  });

  it('sends no raw sample, file name or hash', async () => {
    // Opting into AI sends the findings, which is inherent. It should not also send the log's
    // identity: the file name and SHA-256 identify the flight and add nothing to an explanation
    // (doc 04 §8 — nothing is uploaded that does not have to be).
    const result = await runFixture('degraded-flight.bin');
    const prompt = renderContext(buildAiContext(result));

    expect(prompt).not.toContain(result.dataset.provenance.sha256);
    expect(prompt).not.toContain(result.dataset.provenance.fileName);
  });

  it('says the criteria are provisional, so the model does not present them as settled', async () => {
    const prompt = renderContext(await contextFor());

    expect(prompt).toContain('provisional');
  });

  it('renders the same prompt twice from the same context', async () => {
    const context = await contextFor();

    expect(renderContext(context)).toBe(renderContext(context));
  });
});
