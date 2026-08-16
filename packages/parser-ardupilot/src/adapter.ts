/**
 * The ArduPilot ingestion adapter.
 *
 * Turns decoded DataFlash records into canonical signals. Three decisions worth stating outright:
 *
 * **Time.** Every timestamped message carries `TimeUS`, microseconds since boot, so the dataset's
 * `TimeBase` is `BOOT` with `syncUncertaintySeconds: null`. Null, not 0 — the log gives no basis
 * for claiming the boot clock is synchronised to UTC, and doc 02 §3 invariant 6 makes null the
 * only spelling of "unknown". A GPS-derived epoch could be established later, but it would be a
 * claim with evidence behind it, not a default.
 *
 * **Declared but never logged.** Doc 05's Phase B acceptance requires a field whose message type
 * was declared in FMT but never actually written to surface as `Validity.UNSUPPORTED` rather than
 * `MISSING` or a default. The two states mean different things: MISSING is "no sample at this
 * instant", UNSUPPORTED is "this firmware/configuration never provides it at all". Such a signal is
 * emitted with one sample at t=0 carrying NaN and UNSUPPORTED, because per-sample validity is the
 * only place the model can say it. A zero-sample signal would be indistinguishable from a message
 * type the log never mentioned.
 *
 * **Unmapped fields.** A field with no catalog entry is not emitted. Doc 02 §3 invariant 2 forbids
 * a numeric signal without a real unit, and guessing one is the failure mode this package exists to
 * avoid. Unmapped fields are listed in `unmappedFields` so the omission is visible rather than
 * silent.
 */
import {
  canonicalUnitFor,
  convertToCanonical,
  createSignal,
  createTimeBase,
} from '@pandalog/core-domain';
import type { ParsedFlightData, ParserAdapter, SourceFile } from '@pandalog/ingestion';
import { Validity, type Signal, type SourceEvent } from '@pandalog/schema';

import { lookupSignal, SOURCE_EVENT_MESSAGES, TIME_FIELD } from './catalog.js';
import {
  decodeDataflash,
  HEAD_BYTE_1,
  HEAD_BYTE_2,
  type DataflashLog,
  type DecodedRecord,
} from './dataflash.js';

export const PARSER_PACKAGE = '@pandalog/parser-ardupilot';
export const PARSER_VERSION = '0.1.0';
export const SOURCE_FORMAT = 'ardupilot-dataflash';

const MICROSECONDS_PER_SECOND = 1e6;

interface SignalAccumulator {
  readonly id: string;
  readonly sourceUnit: string;
  readonly times: number[];
  readonly values: number[];
}

function timestampSeconds(record: DecodedRecord): number | null {
  const raw = record.fields.get(TIME_FIELD);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw / MICROSECONDS_PER_SECOND : null;
}

function toSourceEvent(record: DecodedRecord, type: string, t: number): SourceEvent {
  const payload: Record<string, unknown> = {};
  for (const [label, value] of record.fields) {
    if (label !== TIME_FIELD) {
      payload[label] = value;
    }
  }
  return { t_rel_seconds: t, type, payload };
}

/** Fields the log declared but whose meaning this package has not established. */
export interface AdapterDiagnostics {
  readonly unmappedFields: readonly string[];
}

export interface ArduPilotParseResult extends ParsedFlightData {
  readonly diagnostics: AdapterDiagnostics;
}

export function toParsedFlightData(log: DataflashLog): ArduPilotParseResult {
  const timeBase = createTimeBase({ origin: 'BOOT' });
  const accumulators = new Map<string, SignalAccumulator>();
  const sourceEvents: SourceEvent[] = [];
  const unmapped = new Set<string>();
  const seenMessageNames = new Set<string>();

  for (const record of log.records) {
    seenMessageNames.add(record.name);

    const eventType = SOURCE_EVENT_MESSAGES[record.name];
    const t = timestampSeconds(record);

    if (eventType !== undefined) {
      // An event without a timestamp cannot be placed on the timeline; dropping it silently would
      // hide a mode change, so it is reported as unmapped instead.
      if (t === null) {
        unmapped.add(`${record.name}.${TIME_FIELD}`);
      } else {
        sourceEvents.push(toSourceEvent(record, eventType, t));
      }
      continue;
    }

    if (t === null) {
      continue;
    }

    for (const [label, value] of record.fields) {
      if (label === TIME_FIELD) {
        continue;
      }

      const mapping = lookupSignal(record.name, label);
      if (mapping === null) {
        unmapped.add(`${record.name}.${label}`);
        continue;
      }
      if (typeof value !== 'number') {
        unmapped.add(`${record.name}.${label}`);
        continue;
      }

      let accumulator = accumulators.get(mapping.id);
      if (accumulator === undefined) {
        accumulator = { id: mapping.id, sourceUnit: mapping.sourceUnit, times: [], values: [] };
        accumulators.set(mapping.id, accumulator);
      }
      accumulator.times.push(t);
      accumulator.values.push(value);
    }
  }

  const signals: Signal[] = [];

  for (const accumulator of accumulators.values()) {
    signals.push(
      createSignal({
        id: accumulator.id,
        // Conversion goes through core-domain's table, the only place it may happen
        // (doc 02 §3 invariant 5). This package never applies a factor of its own.
        unit: canonicalUnitFor(accumulator.sourceUnit),
        sourceUnit: accumulator.sourceUnit,
        timeBase,
        samples: accumulator.times.map((time, index) => {
          const raw = accumulator.values[index];
          const isFinite = raw !== undefined && Number.isFinite(raw);
          return {
            t_rel_seconds: time,
            // A NaN logged by the vehicle is a real statement that it had no value here, so it
            // becomes INVALID with NaN rather than being converted into a plausible number.
            value: isFinite ? convertToCanonical(raw, accumulator.sourceUnit) : NaN,
            validity: isFinite ? Validity.VALID : Validity.INVALID,
          };
        }),
      }),
    );
  }

  // Declared in FMT but never written: UNSUPPORTED, not MISSING (doc 05 Phase B acceptance).
  for (const messageFormat of log.formats.values()) {
    if (seenMessageNames.has(messageFormat.name)) {
      continue;
    }
    for (const label of messageFormat.labels) {
      const mapping = lookupSignal(messageFormat.name, label);
      if (mapping === null || accumulators.has(mapping.id)) {
        continue;
      }
      signals.push(
        createSignal({
          id: mapping.id,
          unit: canonicalUnitFor(mapping.sourceUnit),
          sourceUnit: mapping.sourceUnit,
          timeBase,
          samples: [{ t_rel_seconds: 0, value: NaN, validity: Validity.UNSUPPORTED }],
        }),
      );
    }
  }

  return {
    vehicle: { frameClass: null, firmwareVersion: null, firmwareHash: null },
    timeBase,
    signals,
    sourceEvents,
    diagnostics: { unmappedFields: [...unmapped].sort() },
  };
}

/**
 * Recognise a DataFlash log by its first packet header.
 *
 * Positively rejects anything else, including the text `.log` rendering (ADR-0009), so an
 * unsupported file produces a clear NO_ADAPTER rather than a confusing parse failure.
 */
export function looksLikeDataflash(file: SourceFile): boolean {
  return file.bytes.length >= 3 && file.bytes[0] === HEAD_BYTE_1 && file.bytes[1] === HEAD_BYTE_2;
}

export const arduPilotAdapter: ParserAdapter = {
  metadata: {
    packageName: PARSER_PACKAGE,
    version: PARSER_VERSION,
    format: SOURCE_FORMAT,
  },
  canParse: looksLikeDataflash,
  parse(file: SourceFile): ParsedFlightData {
    return toParsedFlightData(decodeDataflash(file.bytes));
  },
};
