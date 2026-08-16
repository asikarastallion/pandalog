/**
 * DataFlash format characters.
 *
 * Each field in a DataFlash record is described by one character in its message's FMT declaration.
 * This table is the single place those characters are interpreted: width, signedness, endianness
 * and scale factor. Everything else in the parser asks this module rather than knowing widths of
 * its own, because a width duplicated in two places is a width that will eventually disagree.
 *
 * The scaled integer forms (`c C e E L`) store a value pre-multiplied on the vehicle to avoid
 * floating point in the logger; dividing here is a lossless recovery of what was measured, not a
 * unit conversion. Unit conversion happens later, in `@pandalog/core-domain` (doc 04 §1 rule 7).
 *
 * Reference: ArduPilot `libraries/AP_Logger/LogStructure.h`.
 */
import { ArduPilotParseError } from './errors.js';

/** What a decoded field can be before it becomes a canonical sample. */
export type FieldValue = number | string | readonly number[];

export interface FieldType {
  readonly size: number;
  /** Human-readable description, used in diagnostics. */
  readonly description: string;
  readonly read: (view: DataView, offset: number) => FieldValue;
}

const HUNDREDTHS = 100;
/** Latitude/longitude are stored as degrees x 1e7. */
const LATLON_SCALE = 1e7;
const INT16_ARRAY_LENGTH = 32;

function readString(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const byte = view.getUint8(offset + i);
    // Fields are NUL-padded to a fixed width; the name ends at the first NUL.
    if (byte === 0) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

export const FIELD_TYPES: Readonly<Record<string, FieldType>> = Object.freeze({
  b: { size: 1, description: 'int8', read: (v, o) => v.getInt8(o) },
  B: { size: 1, description: 'uint8', read: (v, o) => v.getUint8(o) },
  M: { size: 1, description: 'uint8 flight mode', read: (v, o) => v.getUint8(o) },

  h: { size: 2, description: 'int16', read: (v, o) => v.getInt16(o, true) },
  H: { size: 2, description: 'uint16', read: (v, o) => v.getUint16(o, true) },
  c: { size: 2, description: 'int16 x100', read: (v, o) => v.getInt16(o, true) / HUNDREDTHS },
  C: { size: 2, description: 'uint16 x100', read: (v, o) => v.getUint16(o, true) / HUNDREDTHS },

  i: { size: 4, description: 'int32', read: (v, o) => v.getInt32(o, true) },
  I: { size: 4, description: 'uint32', read: (v, o) => v.getUint32(o, true) },
  f: { size: 4, description: 'float32', read: (v, o) => v.getFloat32(o, true) },
  e: { size: 4, description: 'int32 x100', read: (v, o) => v.getInt32(o, true) / HUNDREDTHS },
  E: { size: 4, description: 'uint32 x100', read: (v, o) => v.getUint32(o, true) / HUNDREDTHS },
  L: {
    size: 4,
    description: 'int32 degrees x1e7',
    read: (v, o) => v.getInt32(o, true) / LATLON_SCALE,
  },
  n: { size: 4, description: 'char[4]', read: (v, o) => readString(v, o, 4) },

  d: { size: 8, description: 'float64', read: (v, o) => v.getFloat64(o, true) },
  // Microsecond timestamps stay exact as doubles until ~285 years of uptime, far beyond any flight.
  q: { size: 8, description: 'int64', read: (v, o) => Number(v.getBigInt64(o, true)) },
  Q: { size: 8, description: 'uint64', read: (v, o) => Number(v.getBigUint64(o, true)) },

  N: { size: 16, description: 'char[16]', read: (v, o) => readString(v, o, 16) },
  Z: { size: 64, description: 'char[64]', read: (v, o) => readString(v, o, 64) },
  a: {
    size: 64,
    description: 'int16[32]',
    read: (v, o) => {
      const values: number[] = [];
      for (let i = 0; i < INT16_ARRAY_LENGTH; i += 1) {
        values.push(v.getInt16(o + i * 2, true));
      }
      return Object.freeze(values);
    },
  },
});

export function isKnownFormatChar(char: string): boolean {
  return Object.hasOwn(FIELD_TYPES, char);
}

function fieldType(char: string): FieldType {
  const type = FIELD_TYPES[char];
  if (type === undefined) {
    throw new ArduPilotParseError(
      'UNKNOWN_FORMAT_CHAR',
      `Unknown DataFlash format character ${JSON.stringify(char)}. Its width is unknown, so every ` +
        'later field in the record would be misaligned; the log is rejected rather than guessed at.',
      { formatChar: char },
    );
  }
  return type;
}

export function fieldSize(char: string): number {
  return fieldType(char).size;
}

export function decodeField(char: string, view: DataView, offset: number): FieldValue {
  return fieldType(char).read(view, offset);
}

/**
 * Split an FMT record's format string into per-field characters.
 *
 * FMT pads the field to 16 bytes; padding (NUL or space) is not a field. An unrecognised character
 * throws rather than being skipped, because skipping would shift every following field.
 */
export function parseFormatString(format: string): string[] {
  const chars: string[] = [];
  for (const char of format) {
    if (char === '\0' || char === ' ') {
      continue;
    }
    fieldType(char);
    chars.push(char);
  }
  return chars;
}

/** Total body size, in bytes, of a record with this format string. */
export function formatBodySize(format: string): number {
  return parseFormatString(format).reduce((total, char) => total + fieldSize(char), 0);
}
