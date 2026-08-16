/**
 * `@pandalog/schema` — the canonical flight data model (02_CANONICAL_DATA_MODEL.md).
 *
 * Layer 0: zero dependencies, platform neutral. Everything downstream of ingestion reads exactly
 * these shapes and nothing else.
 */

export { CANONICAL_UNITS, isCanonicalUnit } from './units.js';
export type { CanonicalUnit, SourceUnit, UnitConversion } from './units.js';

export { isValidity, isValueBearing, Validity, VALUE_BEARING_VALIDITIES } from './validity.js';

export { isTimeOrigin, TIME_ORIGINS } from './time.js';
export type { TimeBase, TimeOrigin } from './time.js';

export type { Sample, Signal, SignalDerivation } from './signal.js';

export { SCHEMA_VERSION } from './dataset.js';
export type { CanonicalFlightDataset, SourceEvent, SourceProvenance, Vehicle } from './dataset.js';

export {
  validateCanonicalFlightDataset,
  validateProvenance,
  validateSourceEvents,
  validateTimeBase,
  validateVehicle,
} from './validation.js';
export type { ValidationIssue, ValidationIssueCode, ValidationResult } from './validation.js';
