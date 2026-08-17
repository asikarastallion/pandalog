/**
 * `@pandalog/parser-ardupilot` — ArduPilot DataFlash (.BIN) decoding.
 *
 * Layer 3. Binary only; the text `.log` rendering is out of scope (ADR-0009). This is the first
 * concrete adapter written against `@pandalog/ingestion`'s contract, which existed before it did.
 */

export { ArduPilotParseError } from './errors.js';
export type { ArduPilotParseErrorCode } from './errors.js';

export {
  decodeField,
  fieldSize,
  FIELD_TYPES,
  formatBodySize,
  isKnownFormatChar,
  parseFormatString,
} from './format.js';
export type { FieldType, FieldValue } from './format.js';

export {
  decodeDataflash,
  FMT_BODY_SIZE,
  FMT_MESSAGE_TYPE,
  FMT_PACKET_SIZE,
  HEAD_BYTE_1,
  HEAD_BYTE_2,
  PACKET_HEADER_SIZE,
} from './dataflash.js';
export type { DataflashLog, DecodedRecord, MessageFormat } from './dataflash.js';

export { lookupSignal, SIGNAL_CATALOG, SOURCE_EVENT_MESSAGES, TIME_FIELD } from './catalog.js';
export type { SignalMapping } from './catalog.js';

export {
  arduPilotAdapter,
  looksLikeDataflash,
  PARSER_PACKAGE,
  PARSER_VERSION,
  SOURCE_FORMAT,
  toParsedFlightData,
} from './adapter.js';
export type { AdapterDiagnostics, ArduPilotParseResult } from './adapter.js';

export { RECORD_PRECONDITIONS } from './catalog.js';
export type { RecordPrecondition } from './catalog.js';
