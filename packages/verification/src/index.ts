/**
 * `@pandalog/verification` — requirement definitions and the deterministic requirement evaluator.
 *
 * Layer 7. This is the package an engineer's sign-off rests on, so it is built around a single
 * refusal: it will not turn missing evidence into a PASS. Doc 03 §3 states the rule, `result.ts`
 * enforces it at construction, and `evaluate.ts` enforces it again on every result it is handed —
 * including results from requirements this package did not write.
 */

export { VerificationError } from './errors.js';
export type { VerificationErrorCode } from './errors.js';

export {
  asNonEmptyEvidence,
  claimsWithoutEvidence,
  enforceEvidenceRule,
  recordFail,
  recordInconclusive,
  recordNotApplicable,
  recordPass,
} from './result.js';
export type {
  ClaimInput,
  NonEmptyEvidence,
  OpenInput,
  RequirementIdentity,
  VerificationOutcome,
  VerificationResult,
} from './result.js';

export { createRequirementSet } from './requirement.js';
export type {
  CreateRequirementSetInput,
  RequirementContext,
  RequirementDefinition,
  RequirementDocumentation,
  RequirementSet,
  RequirementSource,
} from './requirement.js';

export { verifyRequirements } from './evaluate.js';
export type { VerificationReport } from './evaluate.js';

export {
  ATTITUDE_TRACKING_REQUIREMENT,
  GNSS_AVAILABILITY_REQUIREMENT,
  VIBRATION_REQUIREMENT,
} from './requirements/analysis-backed.js';
export { NO_LOGGED_ERROR_REQUIREMENT } from './requirements/logged-error.js';
export { PROVISIONAL_REQUIREMENT_SET_V1 } from './requirements/provisional-v1.js';
