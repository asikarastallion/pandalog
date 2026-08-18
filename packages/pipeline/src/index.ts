/**
 * `@pandalog/pipeline` — the deterministic pipeline, composed once.
 *
 * Layer 8. Every application asks the same question of a log because they all ask it through here
 * (ADR-0010): a CI run and the same log opened in the browser produce the same findings and the
 * same verification outcomes, because the choice of detectors, rules and requirement set lives in
 * one place rather than in each caller.
 */

export { PIPELINE_STAGES, runPipeline } from './pipeline.js';
export type { PipelineInput, PipelineResult, PipelineStage } from './pipeline.js';
