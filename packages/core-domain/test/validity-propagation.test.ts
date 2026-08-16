/**
 * Validity propagation — 05_IMPLEMENTATION_ROADMAP.md Phase A ("validity propagation on
 * resampling"), 02_CANONICAL_DATA_MODEL.md §3 invariants 1a/1b, ADR-0007.
 *
 * When several samples contribute to one output sample, the output's validity is the *least
 * trustworthy* contribution. Anything else would let a missing reading disappear behind a valid
 * neighbour, which is the exact failure doc 04 §1 rule 6 forbids.
 */
import { describe, expect, it } from 'vitest';

import { propagateValidity, VALIDITY_TRUST_ORDER } from '@pandalog/core-domain';
import { Validity } from '@pandalog/schema';

describe('propagateValidity', () => {
  it('returns VALID only when every contribution is VALID', () => {
    expect(propagateValidity([Validity.VALID, Validity.VALID, Validity.VALID])).toBe(
      Validity.VALID,
    );
  });

  it.each([
    [[Validity.VALID, Validity.MISSING], Validity.MISSING],
    [[Validity.VALID, Validity.INVALID], Validity.INVALID],
    [[Validity.VALID, Validity.UNSUPPORTED], Validity.UNSUPPORTED],
    [[Validity.VALID, Validity.INTERPOLATED], Validity.INTERPOLATED],
  ])('degrades %o to %s', (inputs, expected) => {
    expect(propagateValidity(inputs)).toBe(expected);
  });

  it('picks the least trustworthy state when several degrade', () => {
    expect(propagateValidity([Validity.INTERPOLATED, Validity.MISSING, Validity.INVALID])).toBe(
      Validity.MISSING,
    );
  });

  it('ranks UNSUPPORTED as the least trustworthy state', () => {
    expect(propagateValidity([Validity.MISSING, Validity.UNSUPPORTED, Validity.INVALID])).toBe(
      Validity.UNSUPPORTED,
    );
  });

  it('is order independent', () => {
    const inputs = [Validity.VALID, Validity.INTERPOLATED, Validity.MISSING];
    expect(propagateValidity(inputs)).toBe(propagateValidity([...inputs].reverse()));
  });

  it('is idempotent for a single contribution', () => {
    for (const validity of VALIDITY_TRUST_ORDER) {
      expect(propagateValidity([validity])).toBe(validity);
    }
  });

  it('treats an empty contribution set as MISSING, never VALID', () => {
    // Nothing contributed, so nothing was measured. Returning VALID here would manufacture a
    // measurement out of an absence.
    expect(propagateValidity([])).toBe(Validity.MISSING);
  });

  it('orders every Validity member exactly once', () => {
    expect(new Set(VALIDITY_TRUST_ORDER).size).toBe(VALIDITY_TRUST_ORDER.length);
    expect(new Set(VALIDITY_TRUST_ORDER)).toEqual(new Set(Object.values(Validity)));
  });
});
