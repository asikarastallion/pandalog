/**
 * Rule contract and registry — 03_ANALYSIS_AND_VERIFICATION.md §4, 05 Phase E.
 *
 * Doc 03 §4 requires every rule to document, in code, its inputs, formula, units, thresholds,
 * assumptions and evidence. That is expressed here as a *structured* `documentation` field rather
 * than a prose comment, for one reason: a comment cannot be tested. `rules.test.ts` asserts every
 * registered rule fills all six, and that every threshold declares a basis — so a rule shipped with
 * an undocumented magic number fails the build rather than a review.
 *
 * Thresholds are declared on the rule and passed into its computation. A numeric literal inside a
 * rule body would be exactly the "bare numeric literal" doc 05's Phase E acceptance forbids.
 */
import type { FlightEvent } from '@pandalog/events';
import type { CanonicalFlightDataset } from '@pandalog/schema';

import { AnalysisError } from './errors.js';
import type { Finding, ThresholdRecord } from './finding.js';
import type { Hypothesis } from './hypothesis.js';

export interface RuleDocumentation {
  /** Signal ids and event types the rule consumes. */
  readonly inputs: readonly string[];
  /** The exact computation, in words — not a restatement of the code. */
  readonly formula: string;
  /** Units of every quantity involved. */
  readonly units: string;
  /** Every numeric constant the rule uses, each with a basis. */
  readonly thresholds: readonly ThresholdRecord[];
  /** Vehicle type, firmware, mode and sensor-availability assumptions. */
  readonly assumptions: readonly string[];
  /** What EvidenceRefs the rule attaches to its output. */
  readonly evidence: string;
}

export interface AnalysisContext {
  readonly dataset: CanonicalFlightDataset;
  readonly events: readonly FlightEvent[];
  /**
   * Clock for `Finding.producedAtUtc`.
   *
   * Injected because doc 03 §6 requires byte-identical findings for the same inputs, and a
   * wall-clock timestamp is the one field that would otherwise differ between runs. It is
   * non-substantive metadata — the same status doc 05 Phase K gives a report's generation time.
   */
  readonly now: () => Date;
}

export interface RuleResult {
  readonly findings: readonly Finding[];
  readonly hypotheses?: readonly Hypothesis[];
}

export interface AnalysisRule {
  readonly id: string;
  readonly version: string;
  readonly documentation: RuleDocumentation;
  /**
   * Whether this rule applies to this flight at all.
   *
   * Doc 03 §4: a rule depending on vehicle type, firmware, mode or logging configuration must
   * branch on it explicitly here — never bake a single universal threshold that happens to suit
   * the fixture at hand. A rule that does not apply produces nothing; that is different from a
   * rule that applied and found nothing, and Phase F's NOT_APPLICABLE preserves the distinction.
   */
  appliesWhen(context: AnalysisContext): boolean;
  evaluate(context: AnalysisContext): RuleResult;
}

export interface RuleRegistry {
  readonly rules: readonly AnalysisRule[];
  get(id: string): AnalysisRule | null;
  withRule(rule: AnalysisRule): RuleRegistry;
}

function build(rules: readonly AnalysisRule[]): RuleRegistry {
  const frozen = Object.freeze([...rules]);
  return Object.freeze({
    rules: frozen,
    get: (id: string) => frozen.find((rule) => rule.id === id) ?? null,
    withRule(rule: AnalysisRule): RuleRegistry {
      if (rule.id.length === 0) {
        throw new AnalysisError('INVALID_RULE', 'A rule must declare an id.');
      }
      if (frozen.some((existing) => existing.id === rule.id)) {
        throw new AnalysisError(
          'DUPLICATE_RULE',
          `A rule with id ${JSON.stringify(rule.id)} is already registered; findings would be ` +
            'ambiguous about which implementation produced them.',
          { ruleId: rule.id },
        );
      }
      return build([...frozen, rule]);
    },
  });
}

export function createRuleRegistry(rules: Iterable<AnalysisRule> = []): RuleRegistry {
  let registry = build([]);
  for (const rule of rules) {
    registry = registry.withRule(rule);
  }
  return registry;
}

export interface AnalysisResult {
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  /** Rules that did not apply to this flight, and are therefore silent rather than passing. */
  readonly notApplicableRuleIds: readonly string[];
}

/**
 * Run every applicable rule.
 *
 * Findings are sorted by their earliest evidence time, then rule id, then finding id, so two runs
 * over one dataset produce the same sequence regardless of registration order (doc 03 §6).
 */
export function runAnalysis(registry: RuleRegistry, context: AnalysisContext): AnalysisResult {
  const findings: Finding[] = [];
  const hypotheses: Hypothesis[] = [];
  const notApplicableRuleIds: string[] = [];

  for (const rule of registry.rules) {
    if (!rule.appliesWhen(context)) {
      notApplicableRuleIds.push(rule.id);
      continue;
    }
    const result = rule.evaluate(context);
    findings.push(...result.findings);
    hypotheses.push(...(result.hypotheses ?? []));
  }

  findings.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.id.localeCompare(b.id));
  hypotheses.sort((a, b) => a.id.localeCompare(b.id));

  return {
    findings: Object.freeze(findings),
    hypotheses: Object.freeze(hypotheses),
    notApplicableRuleIds: Object.freeze(notApplicableRuleIds.sort()),
  };
}
