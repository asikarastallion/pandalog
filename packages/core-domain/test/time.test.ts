/**
 * TimeBase construction — 02_CANONICAL_DATA_MODEL.md §2 and §3 invariants 3 and 6.
 *
 * The constructor exists so that "unknown synchronisation" cannot be spelled as 0, and so no
 * caller has to remember which fields are mandatory.
 */
import { describe, expect, it } from 'vitest';

import { createTimeBase, InvalidTimeBaseError } from '@pandalog/core-domain';

describe('createTimeBase', () => {
  it('builds a boot-relative time base with unknown synchronisation', () => {
    const timeBase = createTimeBase({ origin: 'BOOT' });

    expect(timeBase).toEqual({
      origin: 'BOOT',
      epochUtc: null,
      syncUncertaintySeconds: null,
      uniformlySampled: false,
    });
  });

  it('defaults synchronisation uncertainty to null, never 0 (invariant 6)', () => {
    expect(createTimeBase({ origin: 'LOG_START' }).syncUncertaintySeconds).toBeNull();
  });

  it('accepts 0 when the caller is making a positive claim', () => {
    const timeBase = createTimeBase({
      origin: 'UTC_EPOCH',
      epochUtc: '2026-01-01T00:00:00.000Z',
      syncUncertaintySeconds: 0,
    });

    expect(timeBase.syncUncertaintySeconds).toBe(0);
  });

  it('records a declared uniform sample interval', () => {
    expect(createTimeBase({ origin: 'BOOT', uniformlySampled: true }).uniformlySampled).toBe(true);
  });

  it('freezes the result so it cannot drift after construction', () => {
    expect(Object.isFrozen(createTimeBase({ origin: 'ARM' }))).toBe(true);
  });

  describe('rejects unrepresentable states', () => {
    it('rejects an unknown origin', () => {
      expect(() => createTimeBase({ origin: 'GPS_WEEK' as 'BOOT' })).toThrow(InvalidTimeBaseError);
    });

    it('rejects a negative synchronisation uncertainty', () => {
      expect(() => createTimeBase({ origin: 'BOOT', syncUncertaintySeconds: -0.001 })).toThrow(
        InvalidTimeBaseError,
      );
    });

    it('rejects NaN synchronisation uncertainty, which would hide "unknown"', () => {
      expect(() => createTimeBase({ origin: 'BOOT', syncUncertaintySeconds: NaN })).toThrow(
        InvalidTimeBaseError,
      );
    });

    it('rejects an infinite synchronisation uncertainty', () => {
      expect(() => createTimeBase({ origin: 'BOOT', syncUncertaintySeconds: Infinity })).toThrow(
        InvalidTimeBaseError,
      );
    });

    it('rejects a non-ISO epoch', () => {
      expect(() => createTimeBase({ origin: 'BOOT', epochUtc: '01/01/2026' })).toThrow(
        InvalidTimeBaseError,
      );
    });

    it('rejects UTC_EPOCH without an epoch, which would be unresolvable', () => {
      expect(() => createTimeBase({ origin: 'UTC_EPOCH' })).toThrow(InvalidTimeBaseError);
    });

    it('carries a structured error code', () => {
      try {
        createTimeBase({ origin: 'BOOT', syncUncertaintySeconds: -1 });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as InvalidTimeBaseError).code).toBe('INVALID_TIME_BASE');
      }
    });
  });
});
