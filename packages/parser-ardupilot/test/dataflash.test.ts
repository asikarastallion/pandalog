/**
 * DataFlash packet decoding, including every way a log can be malformed.
 *
 * Doc 05 Phase B acceptance: "Malformed/truncated binary input throws a structured IngestionError,
 * no partial dataset returned." The parser's half of that is throwing a structured
 * ArduPilotParseError; `adapter.test.ts` covers the ingestion wrapping.
 */
import { describe, expect, it } from 'vitest';

import {
  ArduPilotParseError,
  decodeDataflash,
  FMT_PACKET_SIZE,
  HEAD_BYTE_1,
  HEAD_BYTE_2,
} from '@pandalog/parser-ardupilot';

import { fixtureBytes } from './support/fixtures.js';

const nominal = fixtureBytes('nominal.bin');

describe('decodeDataflash', () => {
  it('builds the format table from the log FMT records', () => {
    const log = decodeDataflash(nominal);

    const names = [...log.formats.values()].map((format) => format.name).sort();
    expect(names).toEqual(['ATT', 'BARO', 'GPS', 'MODE']);
  });

  it('records each format string and its labels', () => {
    const log = decodeDataflash(nominal);
    const att = [...log.formats.values()].find((format) => format.name === 'ATT');

    expect(att?.format).toBe('QccccCC');
    expect(att?.labels).toEqual([
      'TimeUS',
      'DesRoll',
      'Roll',
      'DesPitch',
      'Pitch',
      'DesYaw',
      'Yaw',
    ]);
    expect(att?.length).toBe(3 + 8 + 2 * 4 + 2 * 2);
  });

  it('decodes every record in the log', () => {
    const log = decodeDataflash(nominal);

    // 20 ATT + 20 BARO + 10 GPS + 1 MODE
    expect(log.records).toHaveLength(51);
  });

  it('decodes field values by their declared type', () => {
    const log = decodeDataflash(nominal);
    const att = log.records.find((record) => record.name === 'ATT');

    expect(att?.fields.get('TimeUS')).toBe(0);
    // DesYaw is 'C' — uint16 hundredths — so 90 degrees round-trips exactly.
    expect(att?.fields.get('DesYaw')).toBeCloseTo(90, 9);
  });

  it('decodes a text field', () => {
    const log = decodeDataflash(fixtureBytes('mode-change-error.bin'));
    const msg = log.records.find((record) => record.name === 'MSG');

    expect(msg?.fields.get('Message')).toBe('ArduCopter V4.5.0 (synthetic fixture)');
  });

  it('keeps a message type that was declared but never written', () => {
    const log = decodeDataflash(fixtureBytes('gps-glitch.bin'));

    const declared = [...log.formats.values()].map((format) => format.name);
    expect(declared).toContain('VIBE');
    expect(log.records.some((record) => record.name === 'VIBE')).toBe(false);
  });

  describe('rejects malformed input', () => {
    it('reports TRUNCATED when the log ends mid-record', () => {
      const truncated = nominal.slice(0, nominal.length - 5);

      expect(() => decodeDataflash(truncated)).toThrow(ArduPilotParseError);
      try {
        decodeDataflash(truncated);
        expect.unreachable('should have thrown');
      } catch (error) {
        const parseError = error as ArduPilotParseError;
        expect(parseError.code).toBe('TRUNCATED');
        expect(typeof parseError.context.offset).toBe('number');
      }
    });

    it('reports TRUNCATED for an FMT record cut short', () => {
      expect(() => decodeDataflash(nominal.slice(0, FMT_PACKET_SIZE - 1))).toThrow(
        ArduPilotParseError,
      );
    });

    it('reports BAD_HEADER rather than scanning ahead to resynchronise', () => {
      // Silently skipping to the next plausible header would drop records without telling anyone.
      const corrupted = Uint8Array.from(nominal);
      corrupted[FMT_PACKET_SIZE] = 0x00;

      try {
        decodeDataflash(corrupted);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as ArduPilotParseError).code).toBe('BAD_HEADER');
      }
    });

    it('reports UNDECLARED_MESSAGE_TYPE for a record with no FMT', () => {
      const orphan = Uint8Array.from([HEAD_BYTE_1, HEAD_BYTE_2, 0x42, 0x00, 0x00]);
      const withFormats = new Uint8Array(FMT_PACKET_SIZE + orphan.length);
      withFormats.set(nominal.slice(0, FMT_PACKET_SIZE), 0);
      withFormats.set(orphan, FMT_PACKET_SIZE);

      try {
        decodeDataflash(withFormats);
        expect.unreachable('should have thrown');
      } catch (error) {
        const parseError = error as ArduPilotParseError;
        expect(parseError.code).toBe('UNDECLARED_MESSAGE_TYPE');
        expect(parseError.context.messageType).toBe(0x42);
      }
    });

    it('reports MALFORMED_FMT when a declared length disagrees with its format string', () => {
      const corrupted = Uint8Array.from(nominal);
      // Byte 4 of an FMT packet is the declared total length.
      corrupted[4] = 99;

      try {
        decodeDataflash(corrupted);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as ArduPilotParseError).code).toBe('MALFORMED_FMT');
      }
    });

    it('reports NO_FORMAT_TABLE for a file with no FMT records', () => {
      try {
        decodeDataflash(new Uint8Array(0));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as ArduPilotParseError).code).toBe('NO_FORMAT_TABLE');
      }
    });

    it('produces no partial result — it throws instead of returning what it managed to read', () => {
      const truncated = nominal.slice(0, 400);
      let result: unknown = 'not assigned';

      try {
        result = decodeDataflash(truncated);
      } catch {
        // expected
      }

      expect(result).toBe('not assigned');
    });
  });
});
