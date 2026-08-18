/**
 * The deterministic pipeline, composed once.
 *
 * ```text
 * bytes → ingest → detect events → run analysis → verify requirements
 * ```
 *
 * This package contains **no Node-specific code** — no `node:` import, no `process`, no filesystem —
 * and the architecture test enforces that. Doc 01 §2 says `apps/web` and `@pandalog/cli` "differ
 * only in how they invoke the core pipeline and where they read files from, not in what the pipeline
 * does"; keeping the composition platform-free is what makes that true rather than aspirational. The
 * browser Worker runs this exact sequence.
 *
 * What it holds is the *policy*: which detectors, which rules, which requirement set. Those choices
 * belong in one place, because two callers making them differently is how a tool starts giving two
 * answers to the same question — and an engineer comparing a CI run against the same log opened in
 * the browser would have no way to tell which was right (ADR-0010).
 */
import {
  createDefaultRuleRegistry,
  runAnalysis,
  type Finding,
  type Hypothesis,
  type RuleExecution,
} from '@pandalog/analysis';
import { createDefaultDetectorRegistry, detectEvents, type FlightEvent } from '@pandalog/events';
import { createAdapterRegistry, ingest } from '@pandalog/ingestion';
import { arduPilotAdapter } from '@pandalog/parser-ardupilot';
import type { CanonicalFlightDataset } from '@pandalog/schema';
import {
  PROVISIONAL_REQUIREMENT_SET_V1,
  verifyRequirements,
  type RequirementSet,
  type VerificationReport,
} from '@pandalog/verification';

/**
 * The deterministic stages, in the order they run.
 *
 * Named rather than numbered, and reported as *stages* rather than as a percentage: the work each
 * stage does depends on what the log contains, so any percentage would be a number this package
 * invented about its own progress. A stage name is a fact — that stage has started.
 */
export const PIPELINE_STAGES = ['ingesting', 'detecting-events', 'analysing', 'verifying'] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /**
   * Clock for the `producedAtUtc`/`evaluatedAtUtc`/`ingestedAtUtc` stamps.
   *
   * Injected rather than read from the environment because it is the only value that would
   * otherwise differ between two runs of the same log, and doc 03 §6 requires those to be
   * byte-identical.
   */
  readonly now: () => Date;
  /** Requirements to verify against. Defaults to the provisional set (doc 05 Phase F). */
  readonly requirementSet?: RequirementSet;
  /**
   * Called as each stage begins, so a caller can say what is happening during a long decode.
   *
   * Observation only: it cannot alter what the pipeline computes, and a run with no listener
   * produces exactly the same result as one with a listener. A throwing listener is not caught —
   * a caller that breaks its own progress display should hear about it rather than have the
   * analysis swallow it (doc 04 §4).
   */
  readonly onStage?: (stage: PipelineStage) => void;
}

export interface PipelineResult {
  readonly dataset: CanonicalFlightDataset;
  readonly events: readonly FlightEvent[];
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly notApplicableRuleIds: readonly string[];
  /**
   * Every rule that was registered, with the version it ran at (doc 04 §7).
   *
   * Carried through rather than left in `analysis` because this is the only layer that knows which
   * rules were chosen, and a report that cannot name them cannot say what the flight was checked
   * against.
   */
  readonly executedRules: readonly RuleExecution[];
  readonly verification: VerificationReport;
}

const adapters = createAdapterRegistry([arduPilotAdapter]);
const detectors = createDefaultDetectorRegistry();
const rules = createDefaultRuleRegistry();

/**
 * Run a log through every deterministic stage.
 *
 * Each stage consumes the previous stage's output; nothing is recomputed. In particular the
 * requirement evaluator sees the same `FlightEvent` and `Finding` objects the analysis produced, so
 * an `EvidenceRef` in a verification result resolves against the events in the same result.
 *
 * @throws the originating package's error (`IngestionError`, `AnalysisError`, …) — the caller
 * decides how to present a failure, which for the CLI means an exit code rather than a stack trace.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const stage = (name: PipelineStage): void => {
    input.onStage?.(name);
  };

  stage('ingesting');
  const dataset = await ingest(
    { fileName: input.fileName, bytes: input.bytes },
    { registry: adapters, now: input.now },
  );

  stage('detecting-events');
  const events = detectEvents(detectors, { dataset });

  stage('analysing');
  const analysis = runAnalysis(rules, { dataset, events, now: input.now });

  stage('verifying');
  const verification = verifyRequirements(input.requirementSet ?? PROVISIONAL_REQUIREMENT_SET_V1, {
    dataset,
    events,
    findings: analysis.findings,
    now: input.now,
  });

  return {
    dataset,
    events,
    findings: analysis.findings,
    hypotheses: analysis.hypotheses,
    notApplicableRuleIds: analysis.notApplicableRuleIds,
    executedRules: analysis.executedRules,
    verification,
  };
}
