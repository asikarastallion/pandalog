/**
 * What each pipeline stage is doing, in the reader's terms.
 *
 * Here rather than in `LogDropZone.vue` because a component may not import a *value* from
 * `@pandalog/pipeline` (doc 04 §1 rule 1, enforced by `ui-boundary.test.ts`), and `PIPELINE_STAGES`
 * is one. The rule caught this on the first attempt, which is the point of having it: the ordering
 * of the stages is the pipeline's fact, and a component reproducing that list would be a second
 * copy of it, free to drift when a stage is added.
 *
 * **Stages, never a percentage.** How long each stage takes depends on what the log contains — a
 * log with no GNSS spends no time detecting fix loss, one with millions of IMU samples spends most
 * of its time ingesting — so a bar would be a number the app invented about its own progress. That
 * is the same objection doc 04 §7 makes to an invented quantity in a report, and a bar stuck at 80%
 * tells a reader less than a label saying what is happening.
 */
import { PIPELINE_STAGES, type PipelineStage } from '@pandalog/pipeline';

export const STAGES: readonly PipelineStage[] = PIPELINE_STAGES;

export const STAGE_LABELS: Readonly<Record<PipelineStage, string>> = Object.freeze({
  ingesting: 'Decoding the log into the canonical model',
  'detecting-events': 'Detecting flight events',
  analysing: 'Running the analysis rules',
  verifying: 'Verifying against the requirement set',
});

/** How many stages there are. A count of real stages, not a denominator invented for a bar. */
export const STAGE_COUNT = PIPELINE_STAGES.length;

/** Which stage this is, 1-based, for "stage 3 of 4". */
export const stageIndex = (stage: PipelineStage): number => PIPELINE_STAGES.indexOf(stage) + 1;

/** Whether `stage` has already finished, given the one currently running. */
export const isStageDone = (stage: PipelineStage, current: PipelineStage | null): boolean =>
  current !== null && stageIndex(stage) < stageIndex(current);
