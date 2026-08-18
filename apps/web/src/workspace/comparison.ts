/**
 * Comparing this flight against another one already in this browser.
 *
 * `@pandalog/comparison` (doc 05 Phase J) has been complete and tested since it was written and
 * reachable from nowhere — no view, no CLI command, and no entry in `apps/web`'s allowed
 * dependencies, while the manifest described the app as providing a comparison view. ADR-0016's
 * amendment records closing that.
 *
 * Nothing here decides anything. `compareFlights` is the same deterministic function the tests
 * exercise; this module selects the two flights and hands them over.
 *
 * **The baseline is re-run, not restored.** Its bytes are read back from the store and put through
 * the pipeline again, the way reopening a single log already works. Caching a `ComparisonReport`
 * would be faster and would make the screen a statement about what some earlier version of the code
 * concluded; doc 03 §6 guarantees the re-run is byte-identical, so the cost buys nothing.
 *
 * **`INCOMPARABLE` is carried through untouched.** ADR-0012 makes it a first-class answer for the
 * reason `INCONCLUSIVE` is one in verification (doc 03 §3): mismatched time origins, a changed
 * unit, windows that never overlap, two reports answering different requirement sets. Under a
 * boolean every one of those is indistinguishable from a clean result, and the view is the one
 * place a person actually reads the verdict.
 */
import { compareFlights, type ComparisonReport } from '@pandalog/comparison';
import type { PipelineResult } from '@pandalog/pipeline';

import type { LogStore, StoredLogSummary } from './persistence.js';

export type ComparisonState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly baselineSha256: string }
  | {
      readonly status: 'ready';
      readonly baselineSha256: string;
      readonly baselineLabel: string;
      readonly report: ComparisonReport;
    }
  | {
      readonly status: 'failed';
      readonly baselineSha256: string;
      /** What went wrong, verbatim from the domain package (doc 04 §4). */
      readonly message: string;
    };

/** Runs one log's bytes through the pipeline. Injected so this module needs no worker to be tested. */
export type RunLog = (fileName: string, bytes: Uint8Array) => Promise<PipelineResult>;

/**
 * Logs that can serve as a baseline for the open one.
 *
 * The open log is excluded: comparing a flight against itself is the self-consistency property
 * Phase J's acceptance test asserts, not a question an engineer asks of the UI.
 */
export function baselineCandidates(
  stored: readonly StoredLogSummary[],
  openSha256: string | null,
): readonly StoredLogSummary[] {
  return stored.filter((entry) => entry.sha256 !== openSha256);
}

export interface RunComparisonInput {
  readonly subject: PipelineResult;
  readonly subjectLabel: string;
  readonly baselineSha256: string;
  readonly store: LogStore;
  readonly run: RunLog;
  readonly now: () => Date;
}

/**
 * Compare the open flight against a stored one.
 *
 * @returns a `ready` state carrying the report, or a `failed` state naming what stopped it. A
 * comparison that could not run is never reported as a comparison that found nothing.
 */
export async function runComparison(input: RunComparisonInput): Promise<ComparisonState> {
  const stored = await input.store.get(input.baselineSha256);

  if (stored === null) {
    return {
      status: 'failed',
      baselineSha256: input.baselineSha256,
      message:
        'That log is no longer in this browser, so there is nothing to compare against. It may ' +
        'have been forgotten from the landing page, or the storage cleared.',
    };
  }

  let baseline: PipelineResult;
  try {
    baseline = await input.run(stored.fileName, new Uint8Array(stored.bytes));
  } catch (error) {
    return {
      status: 'failed',
      baselineSha256: input.baselineSha256,
      message: `The baseline log could not be re-analysed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    return {
      status: 'ready',
      baselineSha256: input.baselineSha256,
      baselineLabel: stored.fileName,
      report: compareFlights({
        baseline: { label: stored.fileName, ...baseline },
        subject: { label: input.subjectLabel, ...input.subject },
        now: input.now,
      }),
    };
  } catch (error) {
    // compareFlights throws only on an invalid tolerance; every domain difficulty it meets is a
    // reportable INCOMPARABLE rather than an exception, and must reach the screen as one.
    return {
      status: 'failed',
      baselineSha256: input.baselineSha256,
      message: `The comparison could not be configured: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export interface ComparisonAxis {
  readonly name: string;
  readonly verdict: ComparisonReport['verdict'];
  readonly reason: string;
}

/** The four axes as rows, in the order doc 01 §3 lists them. Presentation only. */
export function comparisonAxes(report: ComparisonReport): readonly ComparisonAxis[] {
  return [
    { name: 'Signals', verdict: report.signals.verdict, reason: report.signals.reason },
    { name: 'Events', verdict: report.events.verdict, reason: report.events.reason },
    { name: 'Findings', verdict: report.findings.verdict, reason: report.findings.reason },
    {
      name: 'Verification',
      verdict: report.verification.verdict,
      reason: report.verification.reason,
    },
  ];
}
