/**
 * The deterministic pipeline, composed once.
 *
 * ```text
 * bytes → ingest → detect events → run analysis → verify requirements
 * ```
 *
 * This module deliberately contains **no Node-specific code** — no `node:` import, no `process`, no
 * filesystem. It takes bytes and returns results. Doc 01 §2 says `apps/web` and `@pandalog/cli`
 * "differ only in how they invoke the core pipeline and where they read files from, not in what the
 * pipeline does", and keeping the composition platform-free is what makes that true rather than
 * aspirational: Phase H's worker can run this exact sequence.
 *
 * It lives in `@pandalog/cli` rather than in a package of its own because there is currently one
 * caller. If Phase H needs to share it, that is the moment to promote it — a decision made against
 * real pressure, with an ADR, rather than a package invented in advance of a second consumer
 * (doc 04's roadmap discipline).
 *
 * What it holds is the *policy*: which detectors, which rules, which requirement set. Those choices
 * belong in one place, because two callers making them differently is how a tool starts giving two
 * answers to the same question.
 */
import {
  createDefaultRuleRegistry,
  runAnalysis,
  type Finding,
  type Hypothesis,
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
}

export interface PipelineResult {
  readonly dataset: CanonicalFlightDataset;
  readonly events: readonly FlightEvent[];
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly notApplicableRuleIds: readonly string[];
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
  const dataset = await ingest(
    { fileName: input.fileName, bytes: input.bytes },
    { registry: adapters, now: input.now },
  );

  const events = detectEvents(detectors, { dataset });
  const analysis = runAnalysis(rules, { dataset, events, now: input.now });

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
    verification,
  };
}
