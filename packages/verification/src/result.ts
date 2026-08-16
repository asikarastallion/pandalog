/**
 * VerificationResult — 03_ANALYSIS_AND_VERIFICATION.md §2 and §3.
 *
 * One rule governs this whole file: **missing evidence is never a PASS**. Doc 03 §3 states it for
 * `PASS` and `FAIL` alike — an outcome that makes a claim must attach evidence, or the outcome is
 * `INCONCLUSIVE`. It is enforced three ways here, deliberately overlapping:
 *
 *   1. `recordPass`/`recordFail` take a *non-empty tuple* of evidence, so the common mistake is a
 *      compile error rather than a runtime surprise. A requirement assembling evidence dynamically
 *      calls `asNonEmptyEvidence` and is forced to decide what to do when it has none.
 *   2. Those constructors then run `enforceEvidenceRule` anyway, because a tuple type can be cast
 *      away and an array can be built empty behind it.
 *   3. The evaluator (`evaluate.ts`) applies the same rule to every result it receives, including
 *      results built as plain object literals by requirements it did not write.
 *
 * The rule *downgrades* rather than throws. `INCONCLUSIVE` is not an error state here — it is the
 * defined, correct answer for "the data does not support a claim", so producing it is more honest
 * than aborting the run, and a partly-inconclusive verification report is still useful. That the
 * downgrade happened is never hidden: it is written into `reason`, and the evaluator lists the
 * requirement in `evidenceRuleViolations`.
 */
import { validateEvidenceRef, type EvidenceRef } from '@pandalog/analysis';

import { VerificationError } from './errors.js';

export type VerificationOutcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';

/** The outcomes that assert something about the flight, and therefore owe evidence. */
const CLAIMING_OUTCOMES: ReadonlySet<VerificationOutcome> = new Set<VerificationOutcome>([
  'PASS',
  'FAIL',
]);

export interface RequirementIdentity {
  readonly id: string;
  /** Semver; a requirement's logic changing is a version bump (doc 03 §2). */
  readonly version: string;
}

export interface VerificationResult {
  readonly requirementId: string;
  readonly requirementVersion: string;
  readonly outcome: VerificationOutcome;
  /** MANDATORY when outcome is PASS or FAIL. */
  readonly evidence: readonly EvidenceRef[];
  readonly reason: string;
  readonly evaluatedAtUtc: string;
}

/** Evidence known to be non-empty at compile time. */
export type NonEmptyEvidence = readonly [EvidenceRef, ...EvidenceRef[]];

/**
 * Narrow a dynamically-built evidence list to a non-empty tuple, or `null` if there is none.
 *
 * The `null` branch is the point: a requirement that finds nothing to cite must choose
 * `recordInconclusive`, and this makes that a decision the author writes down rather than one they
 * can skip past.
 */
export function asNonEmptyEvidence(evidence: readonly EvidenceRef[]): NonEmptyEvidence | null {
  const [first, ...rest] = evidence;
  return first === undefined ? null : [first, ...rest];
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

interface BaseInput {
  readonly requirement: RequirementIdentity;
  readonly reason: string;
  readonly evaluatedAtUtc: string;
}

/** Input for an outcome that asserts something, and so must cite evidence. */
export interface ClaimInput extends BaseInput {
  readonly evidence: NonEmptyEvidence;
}

/** Input for an outcome that asserts nothing; evidence is welcome but not required. */
export interface OpenInput extends BaseInput {
  readonly evidence?: readonly EvidenceRef[];
}

function build(
  outcome: VerificationOutcome,
  input: BaseInput & { readonly evidence: readonly EvidenceRef[] },
): VerificationResult {
  const fail = (message: string): never => {
    throw new VerificationError('INVALID_RESULT', message, {
      requirementId: input.requirement.id,
      outcome,
    });
  };

  if (input.requirement.id.length === 0) {
    fail('A verification result must name the requirement it answers.');
  }
  if (!SEMVER_RE.test(input.requirement.version)) {
    fail(
      `Requirement ${input.requirement.id} declares version ` +
        `${JSON.stringify(input.requirement.version)}, which is not semver. A result must be ` +
        'traceable to the exact requirement logic that produced it (doc 03 §2).',
    );
  }
  if (input.reason.trim().length === 0) {
    fail(
      `Requirement ${input.requirement.id} produced ${outcome} with no reason. An outcome an ` +
        'engineer cannot read is not a verification.',
    );
  }
  if (!ISO_UTC_RE.test(input.evaluatedAtUtc)) {
    fail(
      `evaluatedAtUtc must be an ISO-8601 UTC instant, got ${JSON.stringify(input.evaluatedAtUtc)}.`,
    );
  }

  let evidence: readonly EvidenceRef[];
  try {
    evidence = Object.freeze(input.evidence.map(validateEvidenceRef));
  } catch (error) {
    throw new VerificationError(
      'INVALID_EVIDENCE',
      `Requirement ${input.requirement.id} cited malformed evidence: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { requirementId: input.requirement.id },
    );
  }

  return Object.freeze({
    requirementId: input.requirement.id,
    requirementVersion: input.requirement.version,
    outcome,
    evidence,
    reason: input.reason,
    evaluatedAtUtc: input.evaluatedAtUtc,
  });
}

/** The requirement is met, and here is what shows it. */
export function recordPass(input: ClaimInput): VerificationResult {
  return enforceEvidenceRule(build('PASS', input));
}

/** The requirement is not met, and here is what shows it. */
export function recordFail(input: ClaimInput): VerificationResult {
  return enforceEvidenceRule(build('FAIL', input));
}

/** The data does not support a verdict either way. */
export function recordInconclusive(input: OpenInput): VerificationResult {
  return build('INCONCLUSIVE', { ...input, evidence: input.evidence ?? [] });
}

/** The requirement does not apply to this flight at all (doc 05 Phase F). */
export function recordNotApplicable(input: OpenInput): VerificationResult {
  return build('NOT_APPLICABLE', { ...input, evidence: input.evidence ?? [] });
}

/** True when a result claims PASS or FAIL while citing nothing — doc 03 §3's forbidden state. */
export function claimsWithoutEvidence(result: VerificationResult): boolean {
  return CLAIMING_OUTCOMES.has(result.outcome) && result.evidence.length === 0;
}

/**
 * Downgrade an unevidenced claim to INCONCLUSIVE, recording that it happened.
 *
 * Any other result is returned unchanged, by identity — `INCONCLUSIVE` and `NOT_APPLICABLE` assert
 * nothing and so owe nothing.
 */
export function enforceEvidenceRule(result: VerificationResult): VerificationResult {
  if (!claimsWithoutEvidence(result)) {
    return result;
  }

  const downgraded: VerificationResult = {
    ...result,
    outcome: 'INCONCLUSIVE',
    reason:
      `Requirement ${result.requirementId} reported ${result.outcome} without citing any ` +
      'evidence, and has been recorded INCONCLUSIVE: missing evidence is never a PASS or a FAIL ' +
      `(doc 03 §3). Original reason: ${result.reason}`,
  };

  return Object.freeze(downgraded);
}
