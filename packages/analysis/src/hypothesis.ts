/**
 * Hypothesis — 03_ANALYSIS_AND_VERIFICATION.md §1 and §2.
 *
 * A Hypothesis is a plausible, unconfirmed explanation. It is deliberately a *different type* from
 * Finding rather than a Finding with a flag, because a flag can be ignored and a type cannot:
 *
 *   Hypothesis has no `severity` and no `verificationStatus` — it cannot masquerade as an
 *   established result, and nothing downstream can read a pass/fail out of it.
 *
 *   Its `status` is the literal 'UNCONFIRMED', with no other value available.
 *
 * A hypothesis may cite supporting evidence, but unlike a Finding it is not *required* to: the
 * point of a hypothesis is that it is not yet established. What it must do is name the findings it
 * is trying to explain, so a reader can see what prompted it.
 */
import { validateEvidenceRef, type EvidenceRef } from './evidence.js';
import { AnalysisError } from './errors.js';

export interface Hypothesis {
  readonly id: string;
  readonly relatedFindingIds: readonly string[];
  readonly statement: string;
  readonly supportingEvidence: readonly EvidenceRef[];
  /** Explicit acknowledgment this is not established. Never coexists with a PASS/FAIL claim. */
  readonly status: 'UNCONFIRMED';
}

export interface CreateHypothesisInput {
  readonly id: string;
  readonly relatedFindingIds: readonly string[];
  readonly statement: string;
  readonly supportingEvidence?: readonly EvidenceRef[];
}

export function createHypothesis(input: CreateHypothesisInput): Hypothesis {
  const fail = (message: string): never => {
    throw new AnalysisError('INVALID_HYPOTHESIS', message, { id: input.id });
  };

  if (input.id.length === 0) {
    fail('A Hypothesis needs a non-empty id.');
  }
  if (input.statement.trim().length === 0) {
    fail('A Hypothesis needs a statement.');
  }
  if (input.relatedFindingIds.length === 0) {
    fail(
      'A Hypothesis must name the finding(s) it attempts to explain. A free-floating speculation ' +
        'with nothing to explain is not a hypothesis about this flight.',
    );
  }
  if (input.relatedFindingIds.some((id) => id.length === 0)) {
    fail('relatedFindingIds must not contain an empty id.');
  }

  return Object.freeze({
    id: input.id,
    relatedFindingIds: Object.freeze([...input.relatedFindingIds]),
    statement: input.statement,
    supportingEvidence: Object.freeze((input.supportingEvidence ?? []).map(validateEvidenceRef)),
    status: 'UNCONFIRMED',
  });
}
