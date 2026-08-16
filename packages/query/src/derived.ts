/**
 * Derived-signal registry — 05_IMPLEMENTATION_ROADMAP.md Phase C, 02_CANONICAL_DATA_MODEL.md §5.
 *
 * A derived signal is a separate artifact, never written back over its input, and it carries a
 * `derivation` block naming the exact method, version and inputs — so the derivation is
 * reproducible from the dataset alone. Versioning is the point: if a filter's implementation
 * changes, findings computed with the old one remain traceable to it.
 *
 * The shipped derivations are the ones Phases D and E actually need, not a speculative library:
 *
 *   query:difference   — desired minus actual, i.e. attitude tracking error (doc 05 Phase E)
 *   query:magnitude3   — vector magnitude, i.e. vibration level (doc 05 Phase D)
 *   query:rolling-rms  — windowed RMS, i.e. "Roll RMS error over t=[a,b]" (doc 03 §1)
 *
 * Validity propagates through `propagateValidity` from core-domain: an output sample is only as
 * trustworthy as the least trustworthy input that contributed to it.
 */
import { createSignalFromColumns, propagateValidity, VALIDITY_CODES } from '@pandalog/core-domain';
import { Validity, type CanonicalUnit, type Signal } from '@pandalog/schema';

import { QueryError } from './errors.js';
import { sourceColumns } from './resample.js';

export interface DerivationContext {
  /** Signals aligned on a common grid; the definition may assume identical time axes. */
  readonly inputs: readonly Signal[];
  readonly parameters: Readonly<Record<string, number>>;
}

export interface DerivationDefinition {
  /** Stable method id recorded in `Signal.derivation.method`, e.g. "query:difference". */
  readonly method: string;
  /** Semver of this implementation; a behaviour change is a version bump (doc 02 §5). */
  readonly version: string;
  readonly inputCount: number;
  /** Canonical unit of the output, given the inputs' units. */
  readonly unitOf: (inputUnits: readonly CanonicalUnit[]) => CanonicalUnit;
  /** Compute output values and validity, one per input sample index. */
  readonly compute: (context: DerivationContext) => {
    readonly values: Float64Array;
    readonly validity: Uint8Array;
  };
}

export interface DerivationRegistry {
  readonly definitions: readonly DerivationDefinition[];
  get(method: string): DerivationDefinition | null;
  withDerivation(definition: DerivationDefinition): DerivationRegistry;
}

function buildRegistry(definitions: readonly DerivationDefinition[]): DerivationRegistry {
  const frozen = Object.freeze([...definitions]);
  return Object.freeze({
    definitions: frozen,
    get: (method: string) => frozen.find((entry) => entry.method === method) ?? null,
    withDerivation(definition: DerivationDefinition): DerivationRegistry {
      if (frozen.some((entry) => entry.method === definition.method)) {
        throw new QueryError(
          'DUPLICATE_DERIVATION',
          `A derivation named ${JSON.stringify(definition.method)} is already registered. Two ` +
            'implementations under one method id would make a derivation block ambiguous.',
          { method: definition.method },
        );
      }
      return buildRegistry([...frozen, definition]);
    },
  });
}

/** Require every input to share one unit — differencing radians with metres is meaningless. */
function requireSameUnit(units: readonly CanonicalUnit[], method: string): CanonicalUnit {
  const [first] = units;
  if (first === undefined) {
    throw new QueryError('INVALID_DERIVATION_INPUT', `${method} needs at least one input.`, {
      method,
    });
  }
  if (units.some((unit) => unit !== first)) {
    throw new QueryError(
      'INVALID_DERIVATION_INPUT',
      `${method} requires inputs in one unit but received ${units.join(', ')}.`,
      { method, units },
    );
  }
  return first;
}

const codeOf = (validity: Validity): number => VALIDITY_CODES[validity];

/** Decode a stored validity code without going through a throwing helper on the hot path. */
const VALIDITY_BY_CODE: readonly Validity[] = Object.freeze(
  Object.entries(VALIDITY_CODES)
    .sort(([, a], [, b]) => a - b)
    .map(([validity]) => validity as Validity),
);

export const DIFFERENCE: DerivationDefinition = {
  method: 'query:difference',
  version: '1.0.0',
  inputCount: 2,
  unitOf: (units) => requireSameUnit(units, 'query:difference'),
  compute: ({ inputs }) => {
    const [minuend, subtrahend] = inputs.map(sourceColumns);
    const length = minuend?.values.length ?? 0;
    const values = new Float64Array(length);
    const validity = new Uint8Array(length);

    for (let i = 0; i < length; i += 1) {
      const a = minuend?.values[i] ?? NaN;
      const b = subtrahend?.values[i] ?? NaN;
      const combined = propagateValidity([
        VALIDITY_BY_CODE[minuend?.validity[i] ?? 1] ?? Validity.MISSING,
        VALIDITY_BY_CODE[subtrahend?.validity[i] ?? 1] ?? Validity.MISSING,
      ]);
      const usable = combined === Validity.VALID || combined === Validity.INTERPOLATED;
      values[i] = usable ? a - b : NaN;
      validity[i] = codeOf(combined);
    }

    return { values, validity };
  },
};

export const MAGNITUDE3: DerivationDefinition = {
  method: 'query:magnitude3',
  version: '1.0.0',
  inputCount: 3,
  unitOf: (units) => requireSameUnit(units, 'query:magnitude3'),
  compute: ({ inputs }) => {
    const columns = inputs.map(sourceColumns);
    const length = columns[0]?.values.length ?? 0;
    const values = new Float64Array(length);
    const validity = new Uint8Array(length);

    for (let i = 0; i < length; i += 1) {
      const combined = propagateValidity(
        columns.map((column) => VALIDITY_BY_CODE[column.validity[i] ?? 1] ?? Validity.MISSING),
      );
      const usable = combined === Validity.VALID || combined === Validity.INTERPOLATED;
      const sumOfSquares = columns.reduce((total, column) => {
        const value = column.values[i] ?? NaN;
        return total + value * value;
      }, 0);
      values[i] = usable ? Math.sqrt(sumOfSquares) : NaN;
      validity[i] = codeOf(combined);
    }

    return { values, validity };
  },
};

export const ROLLING_RMS: DerivationDefinition = {
  method: 'query:rolling-rms',
  version: '1.0.0',
  inputCount: 1,
  unitOf: (units) => requireSameUnit(units, 'query:rolling-rms'),
  compute: ({ inputs, parameters }) => {
    const [column] = inputs.map(sourceColumns);
    const length = column?.values.length ?? 0;
    const windowSeconds = parameters.windowSeconds;

    if (windowSeconds === undefined || !(windowSeconds > 0)) {
      throw new QueryError(
        'INVALID_DERIVATION_INPUT',
        'query:rolling-rms requires a positive windowSeconds parameter; the window length is part ' +
          'of what the number means, so it cannot be defaulted.',
        { windowSeconds },
      );
    }

    const values = new Float64Array(length);
    const validity = new Uint8Array(length);

    for (let i = 0; i < length; i += 1) {
      const end = column?.t[i] ?? NaN;
      const start = end - windowSeconds;
      let sumOfSquares = 0;
      let count = 0;
      const contributions: Validity[] = [];

      for (let j = i; j >= 0; j -= 1) {
        const time = column?.t[j] ?? NaN;
        if (time < start) {
          break;
        }
        const sampleValidity = VALIDITY_BY_CODE[column?.validity[j] ?? 1] ?? Validity.MISSING;
        contributions.push(sampleValidity);
        if (sampleValidity === Validity.VALID || sampleValidity === Validity.INTERPOLATED) {
          const value = column?.values[j] ?? NaN;
          sumOfSquares += value * value;
          count += 1;
        }
      }

      const combined = propagateValidity(contributions);
      const usable =
        count > 0 && (combined === Validity.VALID || combined === Validity.INTERPOLATED);
      values[i] = usable ? Math.sqrt(sumOfSquares / count) : NaN;
      validity[i] = codeOf(
        usable ? combined : combined === Validity.VALID ? Validity.MISSING : combined,
      );
    }

    return { values, validity };
  },
};

/** The derivations Phases D and E need. */
export function createDerivationRegistry(
  definitions: Iterable<DerivationDefinition> = [DIFFERENCE, MAGNITUDE3, ROLLING_RMS],
): DerivationRegistry {
  let registry = buildRegistry([]);
  for (const definition of definitions) {
    registry = registry.withDerivation(definition);
  }
  return registry;
}

export interface DeriveOptions {
  readonly id: string;
  readonly method: string;
  readonly inputs: readonly Signal[];
  readonly parameters?: Readonly<Record<string, number>>;
}

/**
 * Build a derived signal.
 *
 * Inputs must already be aligned on a common grid — use `alignSignals` first. That is deliberate:
 * silently resampling here would hide the synchronisation decision that alignment forces a caller
 * to confront.
 *
 * @throws {QueryError} for an unknown method, the wrong number of inputs, mismatched time axes, or
 * units that cannot be combined.
 */
export function deriveSignal(registry: DerivationRegistry, options: DeriveOptions): Signal {
  const definition = registry.get(options.method);
  if (definition === null) {
    throw new QueryError(
      'UNKNOWN_DERIVATION',
      `No derivation named ${JSON.stringify(options.method)} is registered.`,
      { method: options.method },
    );
  }

  if (options.inputs.length !== definition.inputCount) {
    throw new QueryError(
      'INVALID_DERIVATION_INPUT',
      `${definition.method} takes ${String(definition.inputCount)} inputs but received ` +
        `${String(options.inputs.length)}.`,
      { method: definition.method },
    );
  }

  const [first] = options.inputs;
  if (first === undefined) {
    throw new QueryError('INVALID_DERIVATION_INPUT', `${definition.method} needs inputs.`, {});
  }

  const length = first.samples.length;
  for (const input of options.inputs) {
    if (input.samples.length !== length) {
      throw new QueryError(
        'INVALID_DERIVATION_INPUT',
        `${definition.method} requires inputs on a common grid, but ${input.id} has ` +
          `${String(input.samples.length)} samples against ${String(length)}. Align them first.`,
        { method: definition.method, signalId: input.id },
      );
    }
  }

  const unit = definition.unitOf(options.inputs.map((input) => input.unit));
  const { values, validity } = definition.compute({
    inputs: options.inputs,
    parameters: options.parameters ?? {},
  });

  const t = new Float64Array(length);
  for (const [index, sample] of first.samples.entries()) {
    t[index] = sample.t_rel_seconds;
  }

  return createSignalFromColumns({
    id: options.id,
    unit,
    sourceUnit: null,
    timeBase: first.timeBase,
    columns: { t, values, validity },
    derived: true,
    derivation: {
      method: definition.method,
      version: definition.version,
      inputs: options.inputs.map((input) => input.id),
    },
  });
}
