/**
 * `@pandalog/analysis` — deterministic rules producing evidence-backed findings.
 *
 * Layer 6. The distinction doc 03 §1 insists on runs through this package: a Finding is a claim
 * with evidence, a Hypothesis is an unconfirmed explanation, and they are different types so that
 * neither can quietly become the other.
 */

export { AnalysisError } from './errors.js';
export type { AnalysisErrorCode } from './errors.js';

export { evidenceTimeSpan, validateEvidenceRef } from './evidence.js';
export type { EvidenceRef } from './evidence.js';

export { createFinding, findingId, isThresholdBasis } from './finding.js';
export type {
  CreateFindingInput,
  Finding,
  Measurement,
  Severity,
  ThresholdBasis,
  ThresholdRecord,
} from './finding.js';

export { createHypothesis } from './hypothesis.js';
export type { CreateHypothesisInput, Hypothesis } from './hypothesis.js';

export { proposeHypotheses } from './hypotheses.js';

export { createRuleRegistry, runAnalysis } from './rule.js';
export type {
  AnalysisContext,
  AnalysisResult,
  AnalysisRule,
  RuleDocumentation,
  RuleRegistry,
  RuleResult,
} from './rule.js';

export { ATTITUDE_TRACKING_RULE } from './rules/attitude-tracking.js';
export { GPS_AVAILABILITY_RULE, VIBRATION_LEVEL_RULE } from './rules/event-backed.js';

import { createRuleRegistry } from './rule.js';
import { ATTITUDE_TRACKING_RULE } from './rules/attitude-tracking.js';
import { GPS_AVAILABILITY_RULE, VIBRATION_LEVEL_RULE } from './rules/event-backed.js';

/** The first rule set — small, real, and each threshold declaring its basis (doc 03 §4). */
export const createDefaultRuleRegistry = () =>
  createRuleRegistry([ATTITUDE_TRACKING_RULE, GPS_AVAILABILITY_RULE, VIBRATION_LEVEL_RULE]);
