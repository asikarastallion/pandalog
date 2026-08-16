/**
 * Structural validation of the canonical model — 02_CANONICAL_DATA_MODEL.md §6.
 *
 * `validateCanonicalFlightDataset` is a pure function over `unknown`: it is the boundary guard that
 * `@pandalog/ingestion` runs on every adapter's output before returning it (doc 02 §6), and logs
 * are untrusted input (doc 04 §8), so it must not assume its argument is already well-typed.
 *
 * It reports every issue it finds rather than stopping at the first, because an adapter author
 * fixing a conformance failure needs the whole list, not a one-at-a-time drip.
 *
 * Scope: invariants 1a, 1b, 2, 3 and 6 of doc 02 §3, plus the structural well-formedness those checks
 * depend on. Invariant 4 (immutability) is enforced by the `readonly` types and by
 * `tests/architecture/schema-purity.test.ts`, per the enforcement column in doc 02 §3 — a runtime
 * freeze check is deliberately not used, because `Object.freeze` on a `Map` does not prevent
 * `set`/`delete` and would assert less than it appears to. Invariant 5 (unknown source unit
 * throws) belongs to `@pandalog/core-domain`'s conversion table.
 */
import { isTimeOrigin } from './time.js';
import { isCanonicalUnit } from './units.js';
import { isValidity, VALUE_BEARING_VALIDITIES } from './validity.js';

export type ValidationIssueCode =
  | 'DATASET_NOT_OBJECT'
  | 'SCHEMA_VERSION_INVALID'
  | 'PROVENANCE_INVALID'
  | 'VEHICLE_INVALID'
  | 'TIMEBASE_INVALID'
  | 'SIGNALS_NOT_MAP'
  | 'SIGNAL_ID_MISMATCH'
  | 'SIGNAL_INVALID'
  | 'SIGNAL_UNIT_UNKNOWN'
  | 'SAMPLE_INVALID'
  | 'VALIDITY_VALUE_MISMATCH'
  | 'DERIVATION_MISSING'
  | 'DERIVATION_UNEXPECTED'
  | 'SOURCE_EVENTS_INVALID';

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  /** Dotted/indexed location, e.g. `signals["attitude.roll"].samples[41]`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

function isIso8601Utc(value: unknown): value is string {
  return (
    typeof value === 'string' && ISO_8601_UTC_RE.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Accumulates issues so a single pass can report all of them. */
class IssueLog {
  readonly issues: ValidationIssue[] = [];

  add(code: ValidationIssueCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }
}

function validateTimeBaseInto(value: unknown, path: string, log: IssueLog): void {
  if (!isRecord(value)) {
    log.add('TIMEBASE_INVALID', path, 'TimeBase must be an object');
    return;
  }

  if (!isTimeOrigin(value.origin)) {
    log.add('TIMEBASE_INVALID', `${path}.origin`, 'origin must be one of TIME_ORIGINS');
  }

  const epochUtc = value.epochUtc;
  if (epochUtc !== null && !isIso8601Utc(epochUtc)) {
    log.add(
      'TIMEBASE_INVALID',
      `${path}.epochUtc`,
      'epochUtc must be an ISO-8601 UTC string or null',
    );
  }

  // Invariant 6: null is the only representation of "unknown"; 0 is a positive claim. NaN would
  // smuggle an unknown past that contract, and a negative one-sigma value is meaningless.
  const sync = value.syncUncertaintySeconds;
  if (sync !== null && !(typeof sync === 'number' && Number.isFinite(sync) && sync >= 0)) {
    log.add(
      'TIMEBASE_INVALID',
      `${path}.syncUncertaintySeconds`,
      'syncUncertaintySeconds must be null (unknown) or a finite number >= 0',
    );
  }

  if (typeof value.uniformlySampled !== 'boolean') {
    log.add('TIMEBASE_INVALID', `${path}.uniformlySampled`, 'uniformlySampled must be a boolean');
  }
}

function validateProvenanceInto(value: unknown, log: IssueLog): void {
  const path = 'provenance';
  if (!isRecord(value)) {
    log.add('PROVENANCE_INVALID', path, 'provenance must be an object');
    return;
  }

  if (!isNonEmptyString(value.fileName)) {
    log.add('PROVENANCE_INVALID', `${path}.fileName`, 'fileName must be a non-empty string');
  }

  const sha256 = value.sha256;
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    log.add('PROVENANCE_INVALID', `${path}.sha256`, 'sha256 must be 64 hexadecimal characters');
  }

  const sizeBytes = value.sizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    log.add('PROVENANCE_INVALID', `${path}.sizeBytes`, 'sizeBytes must be a non-negative integer');
  }

  if (!isNonEmptyString(value.format)) {
    log.add('PROVENANCE_INVALID', `${path}.format`, 'format must be a non-empty string');
  }
  if (!isNonEmptyString(value.parserPackage)) {
    log.add(
      'PROVENANCE_INVALID',
      `${path}.parserPackage`,
      'parserPackage must be a non-empty string',
    );
  }
  if (!isSemver(value.parserVersion)) {
    log.add('PROVENANCE_INVALID', `${path}.parserVersion`, 'parserVersion must be semver');
  }
  if (!isIso8601Utc(value.ingestedAtUtc)) {
    log.add(
      'PROVENANCE_INVALID',
      `${path}.ingestedAtUtc`,
      'ingestedAtUtc must be an ISO-8601 UTC string',
    );
  }
}

function validateVehicleInto(value: unknown, log: IssueLog): void {
  const path = 'vehicle';
  if (!isRecord(value)) {
    log.add('VEHICLE_INVALID', path, 'vehicle must be an object');
    return;
  }

  for (const field of ['frameClass', 'firmwareVersion', 'firmwareHash'] as const) {
    if (!isStringOrNull(value[field])) {
      log.add('VEHICLE_INVALID', `${path}.${field}`, `${field} must be a string or null`);
    }
  }
}

function validateSample(value: unknown, path: string, log: IssueLog): void {
  if (!isRecord(value)) {
    log.add('SAMPLE_INVALID', path, 'sample must be an object');
    return;
  }

  const t = value.t_rel_seconds;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    log.add('SAMPLE_INVALID', `${path}.t_rel_seconds`, 't_rel_seconds must be a finite number');
  }

  const validity = value.validity;
  if (!isValidity(validity)) {
    log.add('SAMPLE_INVALID', `${path}.validity`, 'validity must be a member of Validity');
    return;
  }

  const numericValue = value.value;
  if (typeof numericValue !== 'number') {
    log.add('SAMPLE_INVALID', `${path}.value`, 'value must be a number (NaN when not VALID)');
    return;
  }

  // Invariants 1a/1b (doc 02 §3, ADR-0007): value and validity are a pair; neither may be inferred
  // from the other.
  //   1a  value-bearing (VALID, INTERPOLATED)           -> finite value required
  //   1b  non-value-bearing (MISSING, INVALID, UNSUPPORTED) -> NaN required
  // A finite number carrying a non-value-bearing validity is exactly the silent-coercion failure
  // the canonical model exists to prevent; NaN under a value-bearing one destroys a real number.
  if (VALUE_BEARING_VALIDITIES.has(validity)) {
    if (!Number.isFinite(numericValue)) {
      log.add(
        'VALIDITY_VALUE_MISMATCH',
        path,
        `value-bearing validity ${validity} requires a finite value, got ${String(numericValue)}`,
      );
    }
  } else if (!Number.isNaN(numericValue)) {
    log.add(
      'VALIDITY_VALUE_MISMATCH',
      path,
      `non-value-bearing validity ${validity} requires value NaN, got ${String(numericValue)}`,
    );
  }
}

function validateDerivation(value: unknown, path: string, log: IssueLog): void {
  if (!isRecord(value)) {
    log.add('SIGNAL_INVALID', path, 'derivation must be an object');
    return;
  }

  if (!isNonEmptyString(value.method)) {
    log.add('SIGNAL_INVALID', `${path}.method`, 'derivation.method must be a non-empty string');
  }
  if (!isSemver(value.version)) {
    log.add('SIGNAL_INVALID', `${path}.version`, 'derivation.version must be semver');
  }

  const inputs: unknown = value.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0 || !inputs.every(isNonEmptyString)) {
    log.add(
      'SIGNAL_INVALID',
      `${path}.inputs`,
      'derivation.inputs must be a non-empty array of signal ids',
    );
  }
}

function validateSignal(key: string, value: unknown, log: IssueLog): void {
  const path = `signals[${JSON.stringify(key)}]`;

  if (!isRecord(value)) {
    log.add('SIGNAL_INVALID', path, 'signal must be an object');
    return;
  }

  const id = value.id;
  if (!isNonEmptyString(id)) {
    log.add('SIGNAL_INVALID', `${path}.id`, 'signal id must be a non-empty string');
  } else if (id !== key) {
    log.add(
      'SIGNAL_ID_MISMATCH',
      `${path}.id`,
      `signal id ${id} does not match its map key ${key}`,
    );
  }

  if (!isCanonicalUnit(value.unit)) {
    log.add('SIGNAL_UNIT_UNKNOWN', `${path}.unit`, 'unit must be a CanonicalUnit');
  }

  if (!isStringOrNull(value.sourceUnit)) {
    log.add('SIGNAL_INVALID', `${path}.sourceUnit`, 'sourceUnit must be a string or null');
  }

  validateTimeBaseInto(value.timeBase, `${path}.timeBase`, log);

  const derived = value.derived;
  if (typeof derived !== 'boolean') {
    log.add('SIGNAL_INVALID', `${path}.derived`, 'derived must be a boolean');
  }

  const derivation = value.derivation;
  if (derived === true && derivation === undefined) {
    log.add(
      'DERIVATION_MISSING',
      `${path}.derivation`,
      'derived signals must carry a derivation block',
    );
  } else if (derived === false && derivation !== undefined) {
    log.add(
      'DERIVATION_UNEXPECTED',
      `${path}.derivation`,
      'a non-derived signal must not carry a derivation block',
    );
  }
  if (derivation !== undefined) {
    validateDerivation(derivation, `${path}.derivation`, log);
  }

  const samples: unknown = value.samples;
  if (!Array.isArray(samples)) {
    log.add('SIGNAL_INVALID', `${path}.samples`, 'samples must be an array');
    return;
  }
  for (let i = 0; i < samples.length; i += 1) {
    validateSample(samples[i], `${path}.samples[${i}]`, log);
  }
}

function validateSourceEventsInto(value: unknown, log: IssueLog): void {
  const path = 'sourceEvents';
  if (!Array.isArray(value)) {
    log.add('SOURCE_EVENTS_INVALID', path, 'sourceEvents must be an array');
    return;
  }

  for (let i = 0; i < value.length; i += 1) {
    const event: unknown = value[i];
    const eventPath = `${path}[${i}]`;

    if (!isRecord(event)) {
      log.add('SOURCE_EVENTS_INVALID', eventPath, 'source event must be an object');
      continue;
    }

    const t = event.t_rel_seconds;
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      log.add(
        'SOURCE_EVENTS_INVALID',
        `${eventPath}.t_rel_seconds`,
        't_rel_seconds must be a finite number',
      );
    }
    if (!isNonEmptyString(event.type)) {
      log.add('SOURCE_EVENTS_INVALID', `${eventPath}.type`, 'type must be a non-empty string');
    }
    if (!isRecord(event.payload)) {
      log.add('SOURCE_EVENTS_INVALID', `${eventPath}.payload`, 'payload must be an object');
    }
  }
}

/**
 * Focused validators over individual parts of the model.
 *
 * These exist so `@pandalog/core-domain`'s construction path can enforce exactly the same rules
 * without restating them. The rules live here, in the package that owns the model; core-domain
 * calls them at construction time, ingestion calls the whole-dataset validator at the boundary.
 */
export function validateTimeBase(value: unknown, path = 'timeBase'): readonly ValidationIssue[] {
  const log = new IssueLog();
  validateTimeBaseInto(value, path, log);
  return log.issues;
}

export function validateProvenance(value: unknown): readonly ValidationIssue[] {
  const log = new IssueLog();
  validateProvenanceInto(value, log);
  return log.issues;
}

export function validateVehicle(value: unknown): readonly ValidationIssue[] {
  const log = new IssueLog();
  validateVehicleInto(value, log);
  return log.issues;
}

export function validateSourceEvents(value: unknown): readonly ValidationIssue[] {
  const log = new IssueLog();
  validateSourceEventsInto(value, log);
  return log.issues;
}

/**
 * Validate a candidate canonical dataset.
 *
 * Never throws: ingestion decides what a failure means (doc 02 §6 makes it a hard ingestion
 * error), and a validator that threw could not report the full issue list.
 */
export function validateCanonicalFlightDataset(dataset: unknown): ValidationResult {
  const log = new IssueLog();

  if (!isRecord(dataset)) {
    log.add('DATASET_NOT_OBJECT', '', 'expected a CanonicalFlightDataset object');
    return { valid: false, issues: log.issues };
  }

  if (!isSemver(dataset.schemaVersion)) {
    log.add('SCHEMA_VERSION_INVALID', 'schemaVersion', 'schemaVersion must be semver');
  }

  validateProvenanceInto(dataset.provenance, log);
  validateVehicleInto(dataset.vehicle, log);
  validateTimeBaseInto(dataset.timeBase, 'timeBase', log);

  const signals: unknown = dataset.signals;
  if (!(signals instanceof Map)) {
    log.add('SIGNALS_NOT_MAP', 'signals', 'signals must be a Map keyed by signal id');
  } else {
    for (const [key, signal] of signals as ReadonlyMap<unknown, unknown>) {
      if (typeof key !== 'string') {
        log.add('SIGNAL_INVALID', 'signals', 'signal map keys must be strings');
        continue;
      }
      validateSignal(key, signal, log);
    }
  }

  validateSourceEventsInto(dataset.sourceEvents, log);

  return { valid: log.issues.length === 0, issues: log.issues };
}
