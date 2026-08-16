/**
 * `@pandalog/core-domain` — unit conversion, time normalisation, canonical construction and
 * validity propagation (01_SYSTEM_ARCHITECTURE.md §7).
 *
 * Layer 1: depends only on `@pandalog/schema`, platform neutral. This is the only package allowed
 * to know a unit conversion factor or to perform timestamp normalisation.
 */

export {
  CoreDomainError,
  InvalidDatasetError,
  InvalidSignalError,
  InvalidTimeBaseError,
  UnknownUnitError,
} from './errors.js';
export type { CoreDomainErrorCode } from './errors.js';

export {
  canonicalUnitFor,
  convertToCanonical,
  getUnitConversion,
  isKnownSourceUnit,
  KNOWN_SOURCE_UNITS,
} from './units.js';
export type { KnownSourceUnit } from './units.js';

export { createTimeBase } from './time.js';
export type { CreateTimeBaseInput } from './time.js';

export { propagateValidity, VALIDITY_TRUST_ORDER } from './validity-propagation.js';

export {
  createSampleView,
  isValidityCode,
  validityFromCode,
  VALIDITY_CODES,
} from './sample-view.js';
export type { SignalColumns } from './sample-view.js';

export { createSignal, createSignalFromColumns, getSignalColumns } from './signal.js';
export type { CreateSignalFromColumnsInput, CreateSignalInput } from './signal.js';

export { createCanonicalFlightDataset } from './dataset.js';
export type { CreateCanonicalFlightDatasetInput } from './dataset.js';
