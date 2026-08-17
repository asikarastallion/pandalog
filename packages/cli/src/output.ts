/**
 * The CLI's JSON document.
 *
 * Two audiences, one shape. A CI script reads `outcome.exitCode` and stops; an engineer reading the
 * file six months later needs to know which log, which tool version, which requirement set, and
 * what the evidence was — so provenance and the full findings travel with the verdict rather than
 * being summarised away.
 *
 * `log.sha256` is what ties a stored result back to a specific file. Without it a verification
 * record is an assertion about "some flight".
 */
import type { Finding, Hypothesis } from '@pandalog/analysis';
import type { SourceProvenance, TimeBase, Vehicle } from '@pandalog/schema';
import type { VerificationReport } from '@pandalog/verification';

import type { ExitCode } from './exit-codes.js';
import type { PipelineResult } from '@pandalog/pipeline';

export interface CliDocument {
  readonly tool: { readonly name: 'pandalog'; readonly version: string };
  readonly command: 'verify';
  readonly log: SourceProvenance;
  readonly vehicle: Vehicle;
  readonly timeBase: TimeBase;
  readonly counts: {
    readonly signals: number;
    readonly sourceEvents: number;
    readonly events: number;
    readonly findings: number;
    readonly hypotheses: number;
  };
  readonly analysis: {
    readonly findings: readonly Finding[];
    readonly hypotheses: readonly Hypothesis[];
    /** Rules that did not apply, so silence is never mistaken for a clean result. */
    readonly notApplicableRuleIds: readonly string[];
  };
  readonly verification: VerificationReport;
  readonly outcome: {
    readonly exitCode: ExitCode;
    readonly summary: string;
  };
}

export interface DocumentInput {
  readonly version: string;
  readonly result: PipelineResult;
  readonly exitCode: ExitCode;
}

/** One line an engineer can read without opening the JSON. */
export function summarise(report: VerificationReport): string {
  const { PASS, FAIL, INCONCLUSIVE, NOT_APPLICABLE } = report.summary;

  return (
    `${String(PASS)} passed, ${String(FAIL)} failed, ${String(INCONCLUSIVE)} inconclusive, ` +
    `${String(NOT_APPLICABLE)} not applicable`
  );
}

export function buildDocument(input: DocumentInput): CliDocument {
  const { dataset, verification } = input.result;

  return {
    tool: { name: 'pandalog', version: input.version },
    command: 'verify',
    log: dataset.provenance,
    vehicle: dataset.vehicle,
    timeBase: dataset.timeBase,
    counts: {
      signals: dataset.signals.size,
      sourceEvents: dataset.sourceEvents.length,
      events: input.result.events.length,
      findings: input.result.findings.length,
      hypotheses: input.result.hypotheses.length,
    },
    analysis: {
      findings: input.result.findings,
      hypotheses: input.result.hypotheses,
      notApplicableRuleIds: input.result.notApplicableRuleIds,
    },
    verification,
    outcome: { exitCode: input.exitCode, summary: summarise(verification) },
  };
}
