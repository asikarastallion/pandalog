/**
 * `@pandalog/cli` — the deterministic pipeline, headless.
 *
 * Layer 11. The same ingestion, analysis and verification code `apps/web` will run, invoked from a
 * terminal instead of a browser, so a user's own flight-test pipeline can verify every log it
 * produces and act on the exit status.
 */

export { parseArgs, USAGE } from './args.js';
export type { ParsedArgs, VerifyCommand } from './args.js';

export { EXIT, exitCodeFor } from './exit-codes.js';
export type { ExitCode } from './exit-codes.js';

export { runPipeline } from './pipeline.js';
export type { PipelineInput, PipelineResult } from './pipeline.js';

export { buildDocument, summarise } from './output.js';
export type { CliDocument, DocumentInput } from './output.js';

export { CLI_VERSION, runCli } from './run.js';
export type { CliEnvironment } from './run.js';
