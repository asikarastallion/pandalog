/**
 * `@pandalog/reporting` — reproducible report documents.
 *
 * Layer 10: depends on schema, analysis, verification and comparison, platform neutral. It renders
 * their output and computes nothing of its own (doc 04 §7) — a number in a report that is not
 * traceable to one of those packages is a boundary violation, and the document is shaped to make
 * that structural: it embeds the artifacts unchanged rather than projecting them into a copy.
 *
 * Two runs over the same inputs and versions differ only in `generatedAtUtc`, which is why that
 * field sits outside `provenance` — the record of what was analysed is separate from the note of
 * when it was printed.
 */

export { ReportingError } from './errors.js';
export type { ReportingErrorCode } from './errors.js';

export { buildReport } from './build.js';

export { REPORTING_VERSION } from './document.js';
export type {
  ReportCounts,
  ReportDocument,
  ReportInput,
  ReportProvenance,
  RequirementSetIdentity,
} from './document.js';

export { groupFindings, isRepeated } from './rollup.js';
export type { FindingGroup, GroupPeak } from './rollup.js';

export { renderMarkdown } from './markdown.js';
