/**
 * `@pandalog/ai` — the opt-in explanatory layer.
 *
 * Layer 10: depends on schema, analysis, verification and comparison — the read side of the
 * evidence chain, never ingestion, query or events. **Nothing depends on this package.** Deleting
 * the directory leaves `@pandalog/cli` and `apps/web` building and passing, which
 * `tests/architecture/ai-removable.test.ts` checks rather than assumes (doc 01 §4).
 *
 * It explains, summarises, correlates and proposes hypotheses. It never invents a measurement, a
 * timestamp, a severity, a pass/fail or a root cause (doc 04 §1 rule 10) — and that is enforced
 * twice over, because either alone is insufficient:
 *
 *   **By type.** `AiAnswer` has no `severity`, no `outcome`, no `confidence`, no `finding`. There is
 *   no field through which a deterministic result can be overridden.
 *
 *   **At runtime, on every answer.** Every field of `AiAnswer` is free text, and an invented number
 *   inside a sentence is worse than one in a numeric field because it reads like prose an engineer
 *   would trust. `groundAnswer` removes any claim carrying a number the analysis did not produce,
 *   any evidence reference that does not resolve, and any statement asserting an outcome other than
 *   the recorded one — and lists what it removed.
 */

export { AiError } from './errors.js';
export type { AiErrorCode } from './errors.js';

export { EMPTY_ANSWER, parseAnswer, TEXT_FIELDS } from './answer.js';
export type { AiAnswer, TextField } from './answer.js';

export { buildAiContext, renderContext } from './context.js';
export type { AiContext, AiContextInput } from './context.js';

export { groundAnswer } from './grounding.js';
export type { GroundedAnswer, RejectedField, Rejection } from './grounding.js';

export { createProviderClient, DEFAULT_MODEL } from './client.js';
export type { AiClient, ProviderClientConfig } from './client.js';

export { askAi } from './ask.js';
