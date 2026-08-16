/**
 * The requirement evaluator — 03_ANALYSIS_AND_VERIFICATION.md §2, §3, §6.
 *
 * `RequirementDefinition` is an interface, which means a requirement can return whatever object it
 * likes: a PASS with no evidence, a result naming somebody else's requirement, or an exception
 * halfway through. This module treats every result as untrusted input and applies one policy to
 * all three cases — the run continues, and the outcome is `INCONCLUSIVE`. Nothing a requirement
 * does wrong can turn into a PASS.
 *
 * `INCONCLUSIVE` is the right answer for a broken requirement rather than a crash because a
 * verification report with one unusable requirement is still worth reading, while a report that
 * never got produced is not. What must not happen — silently absorbing the failure — does not:
 * the reason names the fault, and `evidenceRuleViolations` lists every requirement that claimed
 * more than it showed.
 */
import { VerificationError } from './errors.js';
import type {
  RequirementContext,
  RequirementDefinition,
  RequirementSet,
  RequirementSource,
} from './requirement.js';
import {
  claimsWithoutEvidence,
  enforceEvidenceRule,
  recordInconclusive,
  recordNotApplicable,
  type RequirementIdentity,
  type VerificationOutcome,
  type VerificationResult,
} from './result.js';

export interface VerificationReport {
  readonly requirementSetId: string;
  readonly requirementSetVersion: string;
  readonly requirementSetSource: RequirementSource;
  /** One result per requirement, ordered by requirement id (doc 03 §6). */
  readonly results: readonly VerificationResult[];
  readonly summary: Readonly<Record<VerificationOutcome, number>>;
  /**
   * Requirements that reported PASS or FAIL while citing nothing.
   *
   * Their results were recorded INCONCLUSIVE, which protects the report — but an implementation
   * that does this is defective, and hiding that would only move the problem.
   */
  readonly evidenceRuleViolations: readonly string[];
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function notApplicableFor(
  requirement: RequirementDefinition,
  identity: RequirementIdentity,
  evaluatedAtUtc: string,
): VerificationResult {
  return recordNotApplicable({
    requirement: identity,
    reason:
      `Outside this flight's applicable envelope, so no PASS or FAIL is claimed. ` +
      requirement.documentation.applicability,
    evaluatedAtUtc,
  });
}

/**
 * Check a foreign result answers the question it was asked.
 *
 * @throws {VerificationError} when the result names a different requirement — which would attach
 * one requirement's verdict to another's id in the report.
 */
function assertAnswersRequirement(result: VerificationResult, identity: RequirementIdentity): void {
  if (result.requirementId !== identity.id) {
    throw new VerificationError(
      'INVALID_RESULT',
      `it returned a result for requirement ${JSON.stringify(result.requirementId)}`,
      { requirementId: identity.id, returnedId: result.requirementId },
    );
  }
}

function evaluateOne(
  requirement: RequirementDefinition,
  context: RequirementContext,
): VerificationResult {
  const identity: RequirementIdentity = { id: requirement.id, version: requirement.version };
  const evaluatedAtUtc = context.now().toISOString();

  try {
    if (!requirement.appliesWhen(context)) {
      return notApplicableFor(requirement, identity, evaluatedAtUtc);
    }

    const result = requirement.evaluate(context);
    assertAnswersRequirement(result, identity);
    return result;
  } catch (error) {
    return recordInconclusive({
      requirement: identity,
      reason:
        `Requirement ${requirement.id} could not be evaluated: ${describe(error)}. An evaluation ` +
        'that did not complete establishes nothing, so it is inconclusive rather than a pass.',
      evaluatedAtUtc,
    });
  }
}

function countOutcomes(
  results: readonly VerificationResult[],
): Readonly<Record<VerificationOutcome, number>> {
  const summary: Record<VerificationOutcome, number> = {
    PASS: 0,
    FAIL: 0,
    INCONCLUSIVE: 0,
    NOT_APPLICABLE: 0,
  };
  for (const result of results) {
    summary[result.outcome] += 1;
  }
  return Object.freeze(summary);
}

/**
 * Evaluate every requirement in a set against one flight.
 *
 * Results are sorted by requirement id, so the report does not depend on registration order and two
 * runs over one context are byte-identical (doc 03 §6).
 */
export function verifyRequirements(
  set: RequirementSet,
  context: RequirementContext,
): VerificationReport {
  const results: VerificationResult[] = [];
  const evidenceRuleViolations: string[] = [];

  for (const requirement of set.requirements) {
    const result = evaluateOne(requirement, context);

    if (claimsWithoutEvidence(result)) {
      evidenceRuleViolations.push(requirement.id);
    }

    results.push(enforceEvidenceRule(result));
  }

  results.sort((a, b) => a.requirementId.localeCompare(b.requirementId));

  return Object.freeze({
    requirementSetId: set.id,
    requirementSetVersion: set.version,
    requirementSetSource: set.source,
    results: Object.freeze(results),
    summary: countOutcomes(results),
    evidenceRuleViolations: Object.freeze(evidenceRuleViolations.sort()),
  });
}
