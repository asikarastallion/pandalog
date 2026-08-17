/**
 * The runtime guard — doc 04 §1 rule 10, doc 03 §7.
 *
 * Doc 04 records rule 10 as checked by "the `AiAnswer` type contract [having] no field that
 * overrides a `VerificationOutcome` or fabricates a `Finding`". That is true and it is half the
 * job: every field of `AiAnswer` is free text, and an invented measurement inside a sentence is
 * worse than one in a numeric field, because it reads like prose an engineer would trust.
 *
 * `@pandalog/reporting` is held to the same rule and can satisfy it structurally — it is code that
 * either does arithmetic or does not, so a test settles it once. Here the output is the adversary
 * and arrives fresh on every call, so the same check has to run at runtime, on every answer:
 *
 *   **numbers**   — every number in a claim must already appear in the context, as a field value or
 *                   inside a rule's own statement, allowing for rounding.
 *   **evidence**  — every reference must be structurally identical to one the deterministic layers
 *                   produced. Not similar: identical.
 *   **outcomes**  — a claim naming a requirement must not assert an outcome other than the recorded
 *                   one. This is the single most damaging sentence this layer could emit.
 *
 * Rejections are removed from the answer and listed, never silently dropped: a caller renders
 * `facts` directly, so a sentence left in it is a sentence somebody reads. And a rejection never
 * discards the rest of the answer — an all-or-nothing guard is one a caller eventually turns off.
 */
import type { EvidenceRef } from '@pandalog/analysis';
import type { VerificationOutcome } from '@pandalog/verification';

import { TEXT_FIELDS, type AiAnswer, type TextField } from './answer.js';
import type { AiContext } from './context.js';

export type RejectedField = TextField | 'evidenceRefs';

export interface Rejection {
  readonly field: RejectedField;
  readonly text: string;
  readonly reason: string;
}

export interface GroundedAnswer {
  /** Only what survived grounding. Safe for a caller to render as-is. */
  readonly answer: AiAnswer;
  /** What was removed, and why. Empty when the model stayed inside the evidence. */
  readonly rejected: readonly Rejection[];
  readonly model: string;
}

/**
 * A number in running text.
 *
 * The lookbehind keeps digits that are part of an identifier out of the check — `REQ-ATT-001` and
 * `gps-fix-loss@3.000000#0` are names, and a guard that read them as measurements would reject the
 * model for citing evidence correctly.
 */
const NUMERIC_TOKEN = /(?<![A-Za-z\d\-_.:@#])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;

const OUTCOME_WORDS: readonly VerificationOutcome[] = [
  'PASS',
  'FAIL',
  'INCONCLUSIVE',
  'NOT_APPLICABLE',
];

/**
 * Every number the deterministic layers produced.
 *
 * Two sources, and both are needed. Numeric *fields* are walked directly, at full precision — a
 * comparison's `maxAbsoluteDifference` is as much analysis output as a `Measurement.value`, and it
 * is nested several levels down. Strings are then mined for numeric tokens, because rules write
 * their own prose and the numbers in it are output too; a model quoting a finding's statement
 * accurately must not be rejected for it.
 *
 * The walk rather than `JSON.stringify` + a regex is deliberate: in JSON every value is preceded by
 * a colon, which `NUMERIC_TOKEN` excludes so that `gps-fix-loss@3.000000#0` is read as a name
 * instead of a measurement. Serialising and matching would silently ground nothing.
 */
function groundedNumbers(context: AiContext): Set<number> {
  const numbers = new Set<number>();

  const walk = (value: unknown): void => {
    if (typeof value === 'number') {
      numbers.add(value);
    } else if (typeof value === 'string') {
      for (const match of value.matchAll(NUMERIC_TOKEN)) {
        numbers.add(Number(match[0]));
      }
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value)) {
        walk(entry);
      }
    }
  };

  walk(context);
  return numbers;
}

/**
 * Whether a written number is one of the grounded ones.
 *
 * Rounding is allowed, within half a unit of the last digit actually written: a model quoting
 * "0.175 rad" for a measured 0.174533 is restating it, not inventing it. Anything further away is a
 * different number, and this layer has no business deciding it is close enough.
 */
function isGrounded(value: number, grounded: ReadonlySet<number>): boolean {
  if (grounded.has(value)) {
    return true;
  }
  const decimals = (String(value).split('.')[1] ?? '').length;
  const halfUlp = 0.5 * 10 ** -decimals;
  for (const source of grounded) {
    if (Math.abs(source - value) <= halfUlp) {
      return true;
    }
  }
  return false;
}

/** Canonical form of an evidence reference, for exact comparison. */
function evidenceKey(reference: EvidenceRef): string | null {
  switch (reference.kind) {
    case 'signal-window':
      return `signal-window|${reference.signalId}|${String(reference.t_start_seconds)}|${String(reference.t_end_seconds)}`;
    case 'event':
      return `event|${reference.eventId}`;
    case 'measurement':
      return `measurement|${reference.signalId}|${String(reference.t_seconds)}|${String(reference.value)}|${reference.unit}`;
    default:
      // A reference with no recognisable kind. Malformed, not merely unmatched.
      return null;
  }
}

function groundedEvidence(context: AiContext): Set<string> {
  const keys = new Set<string>();
  const add = (references: readonly EvidenceRef[]): void => {
    for (const reference of references) {
      const key = evidenceKey(reference);
      if (key !== null) {
        keys.add(key);
      }
    }
  };

  for (const finding of context.findings) {
    add(finding.evidence);
  }
  for (const hypothesis of context.hypotheses) {
    add(hypothesis.supportingEvidence);
  }
  for (const outcome of context.outcomes) {
    add(outcome.evidence);
  }

  return keys;
}

/** The outcome recorded for each requirement, so a claim about one can be checked against it. */
const recordedOutcomes = (context: AiContext): Map<string, VerificationOutcome> =>
  new Map(context.outcomes.map((outcome) => [outcome.requirementId, outcome.outcome]));

/** The reason a claim cannot stand, or null when it can. */
function faultIn(
  text: string,
  numbers: ReadonlySet<number>,
  outcomes: ReadonlyMap<string, VerificationOutcome>,
): string | null {
  for (const match of text.matchAll(NUMERIC_TOKEN)) {
    const value = Number(match[0]);
    if (!isGrounded(value, numbers)) {
      return (
        `states ${match[0]}, which appears in no finding, threshold, measurement or outcome. A ` +
        'number this layer produced is an invented measurement (doc 04 §1 rule 10).'
      );
    }
  }

  for (const [requirementId, recorded] of outcomes) {
    if (!text.includes(requirementId)) {
      continue;
    }
    const asserted = OUTCOME_WORDS.filter(
      (word) => word !== recorded && new RegExp(`\\b${word}\\b`).test(text),
    );
    if (asserted.length > 0) {
      return (
        `names ${requirementId} and asserts ${asserted.join('/')}, but the evaluator recorded ` +
        `${recorded}. This layer does not change a verification outcome (doc 03 §7).`
      );
    }
  }

  return null;
}

/**
 * Strip every claim the context does not support, and say what was stripped.
 *
 * Never throws: an answer that overreached is still worth reading for the parts that did not, and
 * the rejections are the more interesting half of the result when it happens.
 */
export function groundAnswer(answer: AiAnswer, context: AiContext, model: string): GroundedAnswer {
  const numbers = groundedNumbers(context);
  const evidence = groundedEvidence(context);
  const outcomes = recordedOutcomes(context);

  const rejected: Rejection[] = [];
  const kept: Record<TextField, string[]> = {
    facts: [],
    hypotheses: [],
    uncertainties: [],
    recommendedChecks: [],
  };

  for (const field of TEXT_FIELDS) {
    for (const text of answer[field]) {
      const fault = faultIn(text, numbers, outcomes);
      if (fault === null) {
        kept[field].push(text);
      } else {
        rejected.push(Object.freeze({ field, text, reason: `The model ${fault}` }));
      }
    }
  }

  const keptEvidence: EvidenceRef[] = [];
  for (const reference of answer.evidenceRefs) {
    const key = evidenceKey(reference);
    if (key !== null && evidence.has(key)) {
      keptEvidence.push(reference);
    } else {
      rejected.push(
        Object.freeze({
          field: 'evidenceRefs' as const,
          text: JSON.stringify(reference),
          reason:
            'The model cited evidence that does not match anything the analysis produced. An ' +
            'evidence reference must resolve to real evidence already in the dataset (doc 03 §7).',
        }),
      );
    }
  }

  return Object.freeze({
    answer: Object.freeze({
      facts: Object.freeze(kept.facts),
      hypotheses: Object.freeze(kept.hypotheses),
      uncertainties: Object.freeze(kept.uncertainties),
      evidenceRefs: Object.freeze(keptEvidence),
      recommendedChecks: Object.freeze(kept.recommendedChecks),
    }),
    rejected: Object.freeze(rejected),
    model,
  });
}
