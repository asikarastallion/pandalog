/**
 * DataFlash packet decoding.
 *
 * A `.BIN` log is a flat sequence of packets. Each begins with the two header bytes 0xA3 0x95 and
 * a message-type byte, followed by a body whose layout is declared by an earlier `FMT` packet.
 * That is what "self-describing" means here: the file carries its own schema, and a reader needs
 * no knowledge of firmware versions to interpret it.
 *
 * The decoder is strict. A bad header, a truncated tail, a record whose type was never declared,
 * or an FMT whose declared length disagrees with its own field widths all abort the decode with a
 * structured error. Doc 04 §4 requires this: a malformed log yields no dataset rather than a
 * plausible-looking partial one, because a silently truncated flight is worse than a rejected file.
 *
 * Reference: ArduPilot `libraries/AP_Logger/LogStructure.h`.
 */
import { ArduPilotParseError } from './errors.js';
import {
  decodeField,
  fieldSize,
  formatBodySize,
  parseFormatString,
  type FieldValue,
} from './format.js';

export const HEAD_BYTE_1 = 0xa3;
export const HEAD_BYTE_2 = 0x95;
/** Message type of an FMT record. */
export const FMT_MESSAGE_TYPE = 0x80;
/** Header is HEAD1, HEAD2, message type. */
export const PACKET_HEADER_SIZE = 3;

/**
 * FMT's own body layout, fixed by the protocol: type, length, name[4], format[16], labels[64].
 *
 * Hard-coded because it is the bootstrap: the table that describes every other message is itself
 * described by a record we must already be able to read. A log also contains an FMT record
 * describing FMT, which this must agree with.
 */
const FMT_NAME_SIZE = 4;
const FMT_FORMAT_SIZE = 16;
const FMT_LABELS_SIZE = 64;
export const FMT_BODY_SIZE = 1 + 1 + FMT_NAME_SIZE + FMT_FORMAT_SIZE + FMT_LABELS_SIZE;
export const FMT_PACKET_SIZE = PACKET_HEADER_SIZE + FMT_BODY_SIZE;

export interface MessageFormat {
  readonly type: number;
  /** Total packet length including the 3-byte header, as declared by the FMT record. */
  readonly length: number;
  readonly name: string;
  readonly format: string;
  readonly labels: readonly string[];
  readonly fieldChars: readonly string[];
}

export interface DecodedRecord {
  readonly type: number;
  readonly name: string;
  readonly fields: ReadonlyMap<string, FieldValue>;
}

export interface DataflashLog {
  /** Every message type the log declared, whether or not any record of it appears. */
  readonly formats: ReadonlyMap<number, MessageFormat>;
  readonly records: readonly DecodedRecord[];
}

function readFixedString(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[offset + i];
    if (byte === undefined || byte === 0) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function requireBytes(available: number, needed: number, offset: number, what: string): void {
  if (available < needed) {
    throw new ArduPilotParseError(
      'TRUNCATED',
      `Log ends mid-record: ${what} at byte offset ${String(offset)} needs ${String(needed)} ` +
        `bytes but only ${String(available)} remain. No partial dataset is produced.`,
      { offset, needed, available, what },
    );
  }
}

function decodeFormatRecord(bytes: Uint8Array, offset: number): MessageFormat {
  const bodyStart = offset + PACKET_HEADER_SIZE;

  const type = bytes[bodyStart];
  const length = bytes[bodyStart + 1];
  if (type === undefined || length === undefined) {
    throw new ArduPilotParseError('TRUNCATED', `FMT record at ${String(offset)} is incomplete.`, {
      offset,
    });
  }

  const name = readFixedString(bytes, bodyStart + 2, FMT_NAME_SIZE);
  const format = readFixedString(bytes, bodyStart + 2 + FMT_NAME_SIZE, FMT_FORMAT_SIZE);
  const labelText = readFixedString(
    bytes,
    bodyStart + 2 + FMT_NAME_SIZE + FMT_FORMAT_SIZE,
    FMT_LABELS_SIZE,
  );

  const fieldChars = parseFormatString(format);
  const labels = labelText.length === 0 ? [] : labelText.split(',');

  if (labels.length !== fieldChars.length) {
    throw new ArduPilotParseError(
      'MALFORMED_FMT',
      `FMT for ${name} declares ${String(fieldChars.length)} fields but ${String(labels.length)} ` +
        'labels. The record cannot be mapped to named values.',
      { offset, name, format, labels },
    );
  }

  const expectedLength = PACKET_HEADER_SIZE + formatBodySize(format);
  if (length !== expectedLength) {
    throw new ArduPilotParseError(
      'MALFORMED_FMT',
      `FMT for ${name} declares a packet length of ${String(length)} bytes, but its format string ` +
        `${JSON.stringify(format)} describes ${String(expectedLength)}. Trusting either one would ` +
        'misalign every following record.',
      { offset, name, format, declaredLength: length, expectedLength },
    );
  }

  return Object.freeze({ type, length, name, format, labels, fieldChars });
}

function decodeRecord(
  view: DataView,
  offset: number,
  messageFormat: MessageFormat,
): DecodedRecord {
  const fields = new Map<string, FieldValue>();
  let cursor = offset + PACKET_HEADER_SIZE;

  for (const [index, char] of messageFormat.fieldChars.entries()) {
    const label = messageFormat.labels[index];
    if (label === undefined) {
      // Unreachable: decodeFormatRecord proved the counts match.
      throw new ArduPilotParseError(
        'MALFORMED_FMT',
        `Field ${String(index)} of ${messageFormat.name} has no label.`,
        { offset, name: messageFormat.name },
      );
    }
    fields.set(label, decodeField(char, view, cursor));
    cursor += fieldSize(char);
  }

  return Object.freeze({ type: messageFormat.type, name: messageFormat.name, fields });
}

/**
 * Decode a whole DataFlash log.
 *
 * @throws {ArduPilotParseError} on a bad header, truncation, an undeclared message type, a
 * self-inconsistent FMT record, or a file with no format table at all.
 */
export function decodeDataflash(bytes: Uint8Array): DataflashLog {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formats = new Map<number, MessageFormat>();
  const records: DecodedRecord[] = [];

  let offset = 0;
  while (offset < bytes.length) {
    requireBytes(bytes.length - offset, PACKET_HEADER_SIZE, offset, 'packet header');

    if (bytes[offset] !== HEAD_BYTE_1 || bytes[offset + 1] !== HEAD_BYTE_2) {
      throw new ArduPilotParseError(
        'BAD_HEADER',
        `Expected packet header 0xA3 0x95 at byte offset ${String(offset)} but found ` +
          `0x${(bytes[offset] ?? 0).toString(16).toUpperCase()} ` +
          `0x${(bytes[offset + 1] ?? 0).toString(16).toUpperCase()}. The log is not resynchronised ` +
          'by scanning ahead, because that would silently skip records.',
        { offset },
      );
    }

    const messageType = bytes[offset + 2];
    if (messageType === undefined) {
      throw new ArduPilotParseError('TRUNCATED', `Missing message type at ${String(offset)}.`, {
        offset,
      });
    }

    if (messageType === FMT_MESSAGE_TYPE) {
      requireBytes(bytes.length - offset, FMT_PACKET_SIZE, offset, 'FMT record');
      const messageFormat = decodeFormatRecord(bytes, offset);
      formats.set(messageFormat.type, messageFormat);
      offset += FMT_PACKET_SIZE;
      continue;
    }

    const messageFormat = formats.get(messageType);
    if (messageFormat === undefined) {
      throw new ArduPilotParseError(
        'UNDECLARED_MESSAGE_TYPE',
        `Record of type ${String(messageType)} at byte offset ${String(offset)} has no preceding ` +
          'FMT declaration, so its length and layout are unknown.',
        { offset, messageType },
      );
    }

    requireBytes(
      bytes.length - offset,
      messageFormat.length,
      offset,
      `${messageFormat.name} record`,
    );
    records.push(decodeRecord(view, offset, messageFormat));
    offset += messageFormat.length;
  }

  if (formats.size === 0) {
    throw new ArduPilotParseError(
      'NO_FORMAT_TABLE',
      'The log contains no FMT records, so nothing in it can be interpreted. A DataFlash log ' +
        'declares its own message layouts; a file without them is not one.',
      { sizeBytes: bytes.length },
    );
  }

  return Object.freeze({ formats, records: Object.freeze(records) });
}
