/**
 * Moving a `PipelineResult` across the Worker boundary.
 *
 * `Signal.samples` is a Proxy over typed-array storage (doc 02 §4), and a Proxy cannot be
 * structured-cloned. Handing a result straight to `postMessage` therefore fails — and the way it
 * fails is the dangerous part: the main thread can end up with a dataset whose signals all report
 * zero samples, so the app renders empty plots for a log that parsed perfectly and nothing raises
 * an error. Silent emptiness is exactly the class of failure doc 04 §1 rule 6 exists to prevent, so
 * the boundary is explicit rather than incidental.
 *
 * The result crosses as parallel typed arrays — the storage `core-domain` already keeps internally,
 * reached through `getSignalColumns` — and is rebuilt with `createSignalFromColumns`. Nothing here
 * reinterprets a value: no unit is converted, no validity is recomputed, no sample is dropped. The
 * typed arrays are also transferable, so `postMessage` can move the samples instead of copying
 * them, which is the point of doing the work off the main thread in the first place.
 */
import type { Finding, Hypothesis, RuleExecution } from '@pandalog/analysis';
import {
  createCanonicalFlightDataset,
  createSignalFromColumns,
  getSignalColumns,
  VALIDITY_CODES,
} from '@pandalog/core-domain';
import type { FlightEvent } from '@pandalog/events';
import type { PipelineResult } from '@pandalog/pipeline';
import {
  Validity,
  type CanonicalUnit,
  type Signal,
  type SignalDerivation,
  type SourceEvent,
  type SourceProvenance,
  type TimeBase,
  type Vehicle,
} from '@pandalog/schema';
import type { VerificationReport } from '@pandalog/verification';

/** One signal, flattened to what structuredClone can carry. */
export interface TransferableSignal {
  readonly id: string;
  readonly unit: CanonicalUnit;
  readonly sourceUnit: string | null;
  readonly timeBase: TimeBase;
  readonly derived: boolean;
  readonly derivation: SignalDerivation | null;
  readonly t: Float64Array;
  readonly values: Float64Array;
  readonly validity: Uint8Array;
}

export interface TransferableResult {
  readonly provenance: SourceProvenance;
  readonly vehicle: Vehicle;
  readonly timeBase: TimeBase;
  readonly sourceEvents: readonly SourceEvent[];
  readonly signals: readonly TransferableSignal[];
  readonly events: readonly FlightEvent[];
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly notApplicableRuleIds: readonly string[];
  readonly executedRules: readonly RuleExecution[];
  readonly verification: VerificationReport;
}

/** `VALIDITY_CODES` inverted, so a code becomes the Validity it stands for. */
const VALIDITY_BY_CODE: ReadonlyMap<number, Validity> = new Map(
  Object.entries(VALIDITY_CODES).map(([validity, code]) => [code, validity as Validity]),
);

function encodeSignal(signal: Signal): TransferableSignal {
  const columns = getSignalColumns(signal);

  // A signal not backed by columns (a plain-object Signal from a test or a future adapter) is
  // flattened by walking its samples. Slower, but it must not be silently unsupported.
  const t = columns?.t ?? Float64Array.from(signal.samples, (sample) => sample.t_rel_seconds);
  const values = columns?.values ?? Float64Array.from(signal.samples, (sample) => sample.value);
  const validity =
    columns?.validity ??
    Uint8Array.from(signal.samples, (sample) => VALIDITY_CODES[sample.validity]);

  return {
    id: signal.id,
    unit: signal.unit,
    sourceUnit: signal.sourceUnit,
    timeBase: signal.timeBase,
    derived: signal.derived,
    derivation: signal.derivation ?? null,
    t,
    values,
    validity,
  };
}

function decodeSignal(transferable: TransferableSignal): Signal {
  return createSignalFromColumns({
    id: transferable.id,
    unit: transferable.unit,
    sourceUnit: transferable.sourceUnit,
    timeBase: transferable.timeBase,
    derived: transferable.derived,
    columns: {
      t: transferable.t,
      values: transferable.values,
      validity: transferable.validity,
    },
    ...(transferable.derivation === null ? {} : { derivation: transferable.derivation }),
  });
}

export function encodeResult(result: PipelineResult): TransferableResult {
  return {
    provenance: result.dataset.provenance,
    vehicle: result.dataset.vehicle,
    timeBase: result.dataset.timeBase,
    sourceEvents: result.dataset.sourceEvents,
    signals: [...result.dataset.signals.values()].map(encodeSignal),
    events: result.events,
    findings: result.findings,
    hypotheses: result.hypotheses,
    notApplicableRuleIds: result.notApplicableRuleIds,
    executedRules: result.executedRules,
    verification: result.verification,
  };
}

export function decodeResult(transferable: TransferableResult): PipelineResult {
  return {
    dataset: createCanonicalFlightDataset({
      provenance: transferable.provenance,
      vehicle: transferable.vehicle,
      timeBase: transferable.timeBase,
      signals: transferable.signals.map(decodeSignal),
      sourceEvents: transferable.sourceEvents,
    }),
    events: transferable.events,
    findings: transferable.findings,
    hypotheses: transferable.hypotheses,
    notApplicableRuleIds: transferable.notApplicableRuleIds,
    executedRules: transferable.executedRules,
    verification: transferable.verification,
  };
}

/**
 * The buffers `postMessage` may move rather than copy.
 *
 * Transferring detaches them in the Worker, which is safe because the Worker discards the result
 * after posting it.
 */
export function transferablesOf(payload: TransferableResult): Transferable[] {
  return payload.signals.flatMap((signal) => [
    signal.t.buffer,
    signal.values.buffer,
    signal.validity.buffer,
  ]) as Transferable[];
}

/** Exported for the decoder's use and for tests that assert the code mapping is total. */
export const validityForCode = (code: number): Validity =>
  VALIDITY_BY_CODE.get(code) ?? Validity.MISSING;
