/**
 * Signal construction — 02_CANONICAL_DATA_MODEL.md §2, §4, §5.
 *
 * These constructors are the canonical way to produce a `Signal`. They enforce doc 02's invariants
 * at construction time so an invalid signal cannot be built in the first place, rather than being
 * caught later by the validator. Adapters go through here; nothing downstream assembles a `Signal`
 * literal by hand.
 */
import {
  isCanonicalUnit,
  isValidity,
  VALUE_BEARING_VALIDITIES,
  type CanonicalUnit,
  type Sample,
  type Signal,
  type SignalDerivation,
  type SourceUnit,
  type TimeBase,
  type Validity,
} from '@pandalog/schema';

import { InvalidSignalError } from './errors.js';
import {
  createSampleView,
  getSampleViewColumns,
  isValidityCode,
  validityFromCode,
  VALIDITY_CODES,
  type SignalColumns,
} from './sample-view.js';

interface SignalMetadata {
  readonly id: string;
  readonly unit: CanonicalUnit;
  readonly sourceUnit: SourceUnit | null;
  readonly timeBase: TimeBase;
  readonly derived?: boolean;
  readonly derivation?: SignalDerivation;
}

export interface CreateSignalInput extends SignalMetadata {
  readonly samples: Iterable<Sample>;
}

export interface CreateSignalFromColumnsInput extends SignalMetadata {
  readonly columns: SignalColumns;
}

function assertMetadata(metadata: SignalMetadata): void {
  if (metadata.id.length === 0) {
    throw new InvalidSignalError('A signal id must be a non-empty string.', { id: metadata.id });
  }
  if (!isCanonicalUnit(metadata.unit)) {
    throw new InvalidSignalError(
      `Signal ${metadata.id} declares unit ${JSON.stringify(metadata.unit)}, which is not a CanonicalUnit. ` +
        'Convert through the core-domain unit table before constructing the signal.',
      { signalId: metadata.id, unit: metadata.unit },
    );
  }
  if (metadata.sourceUnit !== null && typeof metadata.sourceUnit !== 'string') {
    throw new InvalidSignalError(`Signal ${metadata.id} has a non-string sourceUnit.`, {
      signalId: metadata.id,
    });
  }

  const derived = metadata.derived ?? false;
  if (derived && metadata.derivation === undefined) {
    throw new InvalidSignalError(
      `Derived signal ${metadata.id} must carry a derivation block naming its method, version and inputs (doc 02 §5).`,
      { signalId: metadata.id },
    );
  }
  if (!derived && metadata.derivation !== undefined) {
    throw new InvalidSignalError(
      `Signal ${metadata.id} is not derived but carries a derivation block.`,
      { signalId: metadata.id },
    );
  }
  if (metadata.derivation?.inputs.length === 0) {
    throw new InvalidSignalError(
      `Derived signal ${metadata.id} must name at least one input signal id.`,
      { signalId: metadata.id },
    );
  }
}

/** Enforce doc 02 §3 invariants 1a/1b for one sample. */
function assertSampleValue(
  signalId: string,
  index: number,
  t: number,
  value: number,
  validity: Validity,
): void {
  if (!Number.isFinite(t)) {
    throw new InvalidSignalError(
      `Signal ${signalId} sample ${String(index)} has a non-finite t_rel_seconds.`,
      { signalId, index, t_rel_seconds: t },
    );
  }

  if (VALUE_BEARING_VALIDITIES.has(validity)) {
    if (!Number.isFinite(value)) {
      throw new InvalidSignalError(
        `Signal ${signalId} sample ${String(index)} carries value-bearing validity ${validity} ` +
          `but a non-finite value (${String(value)}). See doc 02 §3 invariant 1a.`,
        { signalId, index, validity, value },
      );
    }
    return;
  }

  if (!Number.isNaN(value)) {
    throw new InvalidSignalError(
      `Signal ${signalId} sample ${String(index)} carries non-value-bearing validity ${validity} ` +
        `but a finite value (${String(value)}). Missing data is never a number. See doc 02 §3 invariant 1b.`,
      { signalId, index, validity, value },
    );
  }
}

function buildSignal(metadata: SignalMetadata, columns: SignalColumns): Signal {
  const derived = metadata.derived ?? false;
  const base = {
    id: metadata.id,
    unit: metadata.unit,
    sourceUnit: metadata.sourceUnit,
    timeBase: metadata.timeBase,
    samples: createSampleView(columns),
    derived,
  };

  // `exactOptionalPropertyTypes` means an absent derivation must be absent, not undefined.
  const signal: Signal =
    metadata.derivation === undefined
      ? base
      : {
          ...base,
          derivation: Object.freeze({
            method: metadata.derivation.method,
            version: metadata.derivation.version,
            inputs: Object.freeze([...metadata.derivation.inputs]),
          }),
        };

  return Object.freeze(signal);
}

/**
 * Build a signal from `Sample` objects.
 *
 * Convenient for adapters and tests working with modest volumes; the samples are transcribed into
 * typed arrays and not retained. Parsers decoding large logs should prefer
 * `createSignalFromColumns` and fill the typed arrays directly.
 *
 * @throws {InvalidSignalError} on malformed metadata or any sample violating invariants 1a/1b.
 */
export function createSignal(input: CreateSignalInput): Signal {
  assertMetadata(input);

  const samples = [...input.samples];
  const t = new Float64Array(samples.length);
  const values = new Float64Array(samples.length);
  const validity = new Uint8Array(samples.length);

  for (const [index, sample] of samples.entries()) {
    if (!isValidity(sample.validity)) {
      throw new InvalidSignalError(
        `Signal ${input.id} sample ${String(index)} has a validity outside the Validity enum.`,
        { signalId: input.id, index, validity: sample.validity },
      );
    }
    assertSampleValue(input.id, index, sample.t_rel_seconds, sample.value, sample.validity);

    t[index] = sample.t_rel_seconds;
    values[index] = sample.value;
    validity[index] = VALIDITY_CODES[sample.validity];
  }

  return buildSignal(input, { t, values, validity });
}

/**
 * Build a signal directly from typed-array columns.
 *
 * The columns are copied, so a caller that reuses or mutates its buffers afterwards cannot alter
 * the constructed signal (doc 02 §3 invariant 4).
 *
 * @throws {InvalidSignalError} on mismatched column lengths, an unrecognised validity code, or any
 * sample violating invariants 1a/1b.
 */
export function createSignalFromColumns(input: CreateSignalFromColumnsInput): Signal {
  assertMetadata(input);

  const { t, values, validity } = input.columns;
  if (t.length !== values.length || t.length !== validity.length) {
    throw new InvalidSignalError(
      `Signal ${input.id} was given columns of differing length ` +
        `(t=${String(t.length)}, values=${String(values.length)}, validity=${String(validity.length)}). ` +
        'Truncating to the shortest would silently discard samples.',
      {
        signalId: input.id,
        tLength: t.length,
        valuesLength: values.length,
        validityLength: validity.length,
      },
    );
  }

  // `validity.entries()` yields defined values, and the lengths were just proven equal, so
  // `readColumn` guards a case the loop bounds already exclude — it exists so a future change to
  // those bounds fails loudly instead of reading `undefined` as a number.
  const readColumn = (column: Float64Array, index: number): number => {
    const value = column[index];
    if (value === undefined) {
      throw new InvalidSignalError(
        `Signal ${input.id} column read at index ${String(index)} is out of range.`,
        { signalId: input.id, index },
      );
    }
    return value;
  };

  for (const [index, code] of validity.entries()) {
    if (!isValidityCode(code)) {
      throw new InvalidSignalError(
        `Signal ${input.id} sample ${String(index)} has unrecognised validity code ${String(code)}.`,
        { signalId: input.id, index, code },
      );
    }
    assertSampleValue(
      input.id,
      index,
      readColumn(t, index),
      readColumn(values, index),
      validityFromCode(code),
    );
  }

  return buildSignal(input, {
    t: t.slice(),
    values: values.slice(),
    validity: validity.slice(),
  });
}

/**
 * The typed-array storage behind a signal, or null if the signal was not built by this package.
 *
 * The arrays are live, not copies — that is the point, since this is the allocation-free read path
 * for analysis code. Treat them as read-only.
 */
export function getSignalColumns(signal: Signal): SignalColumns | null {
  return getSampleViewColumns(signal.samples);
}
