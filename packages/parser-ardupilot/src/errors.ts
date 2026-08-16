/**
 * Parser errors — 04_CLAUDE_CODE_ENGINEERING_CONTRACT.md §4.
 *
 * Enough context to act on without re-running with extra logging: for a binary format that means
 * the byte offset, and where relevant the message type and field being decoded.
 */

export type ArduPilotParseErrorCode =
  /** A format character not declared in FIELD_TYPES. */
  | 'UNKNOWN_FORMAT_CHAR'
  /** The file ended in the middle of a record. */
  | 'TRUNCATED'
  /** Packet header bytes were not 0xA3 0x95 where one was expected. */
  | 'BAD_HEADER'
  /** A record referenced a message type with no preceding FMT declaration. */
  | 'UNDECLARED_MESSAGE_TYPE'
  /** An FMT record was self-inconsistent (declared length disagrees with its field widths). */
  | 'MALFORMED_FMT'
  /** The file contains no FMT records at all, so nothing in it can be interpreted. */
  | 'NO_FORMAT_TABLE';

export class ArduPilotParseError extends Error {
  readonly code: ArduPilotParseErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: ArduPilotParseErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ArduPilotParseError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}
