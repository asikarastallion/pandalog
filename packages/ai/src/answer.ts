/**
 * `AiAnswer` — 03_ANALYSIS_AND_VERIFICATION.md §7.
 *
 * The shape is doc 03's, unchanged, and what matters about it is what it lacks: no `severity`, no
 * `outcome`, no `confidence`, no `finding`. There is no field through which this layer can override
 * a deterministic result, which is doc 04 §1 rule 10's structural half.
 *
 * `parseAnswer` treats a model's output the way `@pandalog/ingestion` treats a log: untrusted input,
 * and worse in one respect — a malformed log is obviously malformed, while a model's output is
 * optimised to look right. So nothing here repairs or partially accepts. A response that is not a
 * well-formed answer raises; it never becomes a half-answer that a caller renders as though the
 * model had said it. Unknown fields are dropped rather than rejected, because a model volunteering
 * a `severity` is a model whose extra opinion simply does not survive the boundary.
 */
import type { EvidenceRef } from '@pandalog/analysis';

import { AiError } from './errors.js';

export interface AiAnswer {
  /** Restatements of findings and verification results. Never new claims. */
  readonly facts: readonly string[];
  /** Proposed explanations, explicitly not established (doc 03 §1). */
  readonly hypotheses: readonly string[];
  readonly uncertainties: readonly string[];
  /** Must resolve to evidence already in the context; checked in `grounding.ts`. */
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly recommendedChecks: readonly string[];
}

/** The text fields, in the order a reader meets them. */
export const TEXT_FIELDS = ['facts', 'hypotheses', 'uncertainties', 'recommendedChecks'] as const;

export type TextField = (typeof TEXT_FIELDS)[number];

export const EMPTY_ANSWER: AiAnswer = Object.freeze({
  facts: Object.freeze([]),
  hypotheses: Object.freeze([]),
  uncertainties: Object.freeze([]),
  evidenceRefs: Object.freeze([]),
  recommendedChecks: Object.freeze([]),
});

/** Pull the JSON out of a response, which models routinely wrap in prose and a fenced block. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start === -1 || end <= start ? text.trim() : text.slice(start, end + 1);
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined || value === null) {
    // A model that omitted the field has said there is nothing to put in it, which is an answer.
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new AiError(
      'UNPARSEABLE_ANSWER',
      `The model returned ${field} as ${typeof value} rather than an array of strings.`,
      { field },
    );
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new AiError(
        'UNPARSEABLE_ANSWER',
        `The model returned a ${typeof entry} inside ${field}, where every entry must be a string.`,
        { field },
      );
    }
  }
  return Object.freeze([...(value as string[])]);
}

function evidenceArray(value: unknown): readonly EvidenceRef[] {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new AiError(
      'UNPARSEABLE_ANSWER',
      `The model returned evidenceRefs as ${typeof value} rather than an array.`,
    );
  }
  // Shape is not validated here: an evidence reference is only acceptable if it *matches one the
  // deterministic layers produced*, which `grounding.ts` decides. Validating it here would let a
  // well-formed invention through this stage looking legitimate.
  return Object.freeze([...(value as EvidenceRef[])]);
}

/**
 * Parse a model response into an answer.
 *
 * @throws {AiError} UNPARSEABLE_ANSWER when the response is not a well-formed answer. There is no
 * partial success: a caller must be able to treat a returned answer as one the model actually gave.
 */
export function parseAnswer(text: string): AiAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new AiError(
      'UNPARSEABLE_ANSWER',
      'The model did not return an answer this layer can read. Rather than guess at what it meant, ' +
        'nothing is reported: an invented reading of an unreadable answer is the failure this ' +
        'package exists to prevent.',
      { received: text.slice(0, 200) },
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AiError('UNPARSEABLE_ANSWER', 'The model returned something that is not an answer.', {
      received: text.slice(0, 200),
    });
  }

  const fields = parsed as Record<string, unknown>;

  return Object.freeze({
    facts: stringArray(fields.facts, 'facts'),
    hypotheses: stringArray(fields.hypotheses, 'hypotheses'),
    uncertainties: stringArray(fields.uncertainties, 'uncertainties'),
    evidenceRefs: evidenceArray(fields.evidenceRefs),
    recommendedChecks: stringArray(fields.recommendedChecks, 'recommendedChecks'),
  });
}
