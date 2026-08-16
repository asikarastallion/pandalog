/**
 * `@pandalog/query` — signal selection, resampling, alignment and derived signals.
 *
 * Layer 4: depends on `@pandalog/schema` and `@pandalog/core-domain`, platform neutral. Everything
 * here is pure computation over a `CanonicalFlightDataset`; nothing reads a file or a format.
 */

export { QueryError } from './errors.js';
export type { QueryErrorCode } from './errors.js';

export {
  matchesPattern,
  selectSignal,
  selectSignals,
  sliceByTime,
  timeSpanOf,
  valueBearingSamples,
} from './selection.js';
export type { TimeWindow } from './selection.js';

export { resampleSignal, sourceColumns, uniformGrid } from './resample.js';
export type { ResampleOptions } from './resample.js';

export { alignSignals, commonTimeSpan, isValueBearing } from './align.js';
export type { AlignmentResult, AlignOptions } from './align.js';

export {
  createDerivationRegistry,
  deriveSignal,
  DIFFERENCE,
  MAGNITUDE3,
  ROLLING_RMS,
} from './derived.js';
export type {
  DerivationContext,
  DerivationDefinition,
  DerivationRegistry,
  DeriveOptions,
} from './derived.js';
