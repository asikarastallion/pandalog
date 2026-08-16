/**
 * RequirementDefinition and RequirementSet — 03_ANALYSIS_AND_VERIFICATION.md §2 and §4.
 *
 * A requirement is the thing a flight test is signed off against, so two properties matter more
 * than convenience:
 *
 *   *Traceability.* A `RequirementSet` states where it came from — a written specification, a
 *   customer test plan, or nothing yet (`provisional`). A set that will not say cannot be built.
 *   The same discipline doc 03 §4 imposes on a threshold applies to the requirement corpus itself,
 *   because "the aircraft passed" is worth exactly as much as the provenance of what it passed.
 *
 *   *Applicability.* Doc 05 Phase F: a requirement outside a flight's envelope produces
 *   `NOT_APPLICABLE`, not a forced PASS or FAIL. `appliesWhen` is where a requirement branches on
 *   vehicle type, mode, or sensor availability (doc 03 §4), and `documentation.applicability` is
 *   the human-readable half of that decision, quoted back in the result.
 */
import { isThresholdBasis, type Finding, type RuleDocumentation } from '@pandalog/analysis';
import type { FlightEvent } from '@pandalog/events';
import type { CanonicalFlightDataset } from '@pandalog/schema';

import { VerificationError } from './errors.js';
import type { VerificationResult } from './result.js';

/**
 * What a requirement is evaluated against.
 *
 * Note what is *not* here: no raw file, no parser. Verification consumes the canonical dataset, the
 * events detected from it, and the findings the analysis layer already produced — it does not
 * recompute analysis. A requirement that disagreed with a `Finding` would give an engineer two
 * different answers to the same question.
 */
export interface RequirementContext {
  readonly dataset: CanonicalFlightDataset;
  readonly events: readonly FlightEvent[];
  readonly findings: readonly Finding[];
  /** Clock for `evaluatedAtUtc`; injected so repeated runs differ in nothing else (doc 03 §6). */
  readonly now: () => Date;
}

/** Doc 03 §4's six fields, plus the applicability statement a NOT_APPLICABLE result quotes. */
export interface RequirementDocumentation extends RuleDocumentation {
  /** When this requirement applies, in words — the prose counterpart of `appliesWhen`. */
  readonly applicability: string;
}

export interface RequirementDefinition {
  readonly id: string;
  readonly version: string;
  /** The requirement as an engineer would read it: "X shall remain within Y". */
  readonly statement: string;
  readonly documentation: RequirementDocumentation;
  appliesWhen(context: RequirementContext): boolean;
  evaluate(context: RequirementContext): VerificationResult;
}

/**
 * Where a requirement set came from.
 *
 * `provisional` is a legitimate answer for a bootstrapping set (doc 05 Phase F allows exactly
 * that), but it must be stated rather than implied — and a provisional requirement says so in its
 * own statement, so a reader of the report cannot miss it.
 */
export type RequirementSource = `spec:${string}` | `test-plan:${string}` | 'provisional';

export interface RequirementSet {
  readonly id: string;
  readonly version: string;
  readonly source: RequirementSource;
  readonly description: string;
  readonly requirements: readonly RequirementDefinition[];
}

export interface CreateRequirementSetInput {
  readonly id: string;
  readonly version: string;
  readonly source: RequirementSource;
  readonly description: string;
  readonly requirements: readonly RequirementDefinition[];
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SOURCE_RE = /^(spec:.+|test-plan:.+|provisional)$/;

function validateDocumentation(requirement: RequirementDefinition): void {
  const fail = (message: string): never => {
    throw new VerificationError(
      'INVALID_REQUIREMENT',
      `Requirement ${requirement.id}: ${message} Doc 03 §4 requires every requirement to document ` +
        'its inputs, formula, units, thresholds, assumptions and evidence in code.',
      { requirementId: requirement.id },
    );
  };

  const documentation = requirement.documentation;

  if (documentation.applicability.trim().length === 0) {
    fail('no applicability statement, so a NOT_APPLICABLE result could not explain itself.');
  }
  if (documentation.inputs.length === 0) {
    fail('names no inputs.');
  }
  if (documentation.formula.trim().length === 0) {
    fail('states no formula.');
  }
  if (documentation.units.trim().length === 0) {
    fail('states no units.');
  }
  if (documentation.assumptions.length === 0) {
    fail('records no assumptions; every requirement makes some.');
  }
  if (documentation.evidence.trim().length === 0) {
    fail('does not say what evidence it attaches.');
  }

  for (const threshold of documentation.thresholds) {
    if (!isThresholdBasis(threshold.basis)) {
      fail(
        `threshold ${JSON.stringify(threshold.label)} declares basis ` +
          `${JSON.stringify(threshold.basis)}, which is neither spec:, empirical: nor provisional.`,
      );
    }
  }
}

/**
 * Build a validated, frozen requirement set.
 *
 * Validation lives here rather than in a test so that a consumer assembling their own set from
 * their own test plan gets the same guarantees this package's shipped set does.
 *
 * @throws {VerificationError} on a malformed set, a duplicate requirement id, or a requirement
 * that does not meet doc 03 §4's documentation contract.
 */
export function createRequirementSet(input: CreateRequirementSetInput): RequirementSet {
  const fail = (
    code: 'INVALID_REQUIREMENT_SET' | 'INVALID_REQUIREMENT',
    message: string,
  ): never => {
    throw new VerificationError(code, message, { setId: input.id });
  };

  if (input.id.length === 0) {
    fail('INVALID_REQUIREMENT_SET', 'A requirement set needs a non-empty id.');
  }
  if (!SEMVER_RE.test(input.version)) {
    fail(
      'INVALID_REQUIREMENT_SET',
      `Requirement set ${input.id} declares version ${JSON.stringify(input.version)}, which is ` +
        'not semver. A verification report must name the exact corpus it was judged against.',
    );
  }
  if (!SOURCE_RE.test(input.source)) {
    fail(
      'INVALID_REQUIREMENT_SET',
      `Requirement set ${input.id} declares source ${JSON.stringify(input.source)}. It must be ` +
        'spec:<document>, test-plan:<plan>, or provisional. "The aircraft passed" is worth what ' +
        'the provenance of the requirements is worth.',
    );
  }
  if (input.requirements.length === 0) {
    fail(
      'INVALID_REQUIREMENT_SET',
      `Requirement set ${input.id} contains no requirements; an empty set would report a flight ` +
        'as verified against nothing.',
    );
  }

  const seen = new Set<string>();
  for (const requirement of input.requirements) {
    if (requirement.id.length === 0) {
      fail('INVALID_REQUIREMENT', 'A requirement needs a non-empty id.');
    }
    if (seen.has(requirement.id)) {
      fail(
        'INVALID_REQUIREMENT',
        `Duplicate requirement id ${JSON.stringify(requirement.id)}; a result names one ` +
          'requirement, and two definitions sharing an id make it ambiguous which was evaluated.',
      );
    }
    seen.add(requirement.id);

    if (!SEMVER_RE.test(requirement.version)) {
      fail(
        'INVALID_REQUIREMENT',
        `Requirement ${requirement.id} declares version ${JSON.stringify(requirement.version)}, ` +
          'which is not semver.',
      );
    }
    if (requirement.statement.trim().length === 0) {
      fail(
        'INVALID_REQUIREMENT',
        `Requirement ${requirement.id} has no statement; a requirement nobody can read cannot be ` +
          'signed off against.',
      );
    }

    validateDocumentation(requirement);
  }

  return Object.freeze({
    id: input.id,
    version: input.version,
    source: input.source,
    description: input.description,
    requirements: Object.freeze([...input.requirements]),
  });
}
