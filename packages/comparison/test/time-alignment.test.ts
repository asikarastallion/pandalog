/**
 * Putting two flights on one time axis — doc 04 §1 rule 8, doc 02 §2.
 *
 * `TimeBase` says outright that a consumer "must not assume ... synchronization across two
 * datasets without checking syncUncertaintySeconds". Comparison is the first package that puts two
 * datasets side by side, so it is the first place that sentence can actually be broken.
 */
import { createTimeBase } from '@pandalog/core-domain';
import { describe, expect, it } from 'vitest';

import { resolveTimeAlignment } from '@pandalog/comparison';

const boot = (syncUncertaintySeconds: number | null = null) =>
  createTimeBase({ origin: 'BOOT', syncUncertaintySeconds });

describe('resolveTimeAlignment', () => {
  it('aligns two flights on elapsed time when both zeros mean the same event', () => {
    const alignment = resolveTimeAlignment(boot(), boot());

    expect(alignment.comparable).toBe(true);
    expect(alignment.basis).toBe('elapsed-since-origin');
    expect(alignment.origin).toBe('BOOT');
  });

  it('refuses to align flights whose zeros mean different events', () => {
    const alignment = resolveTimeAlignment(
      createTimeBase({ origin: 'BOOT' }),
      createTimeBase({ origin: 'ARM' }),
    );

    expect(alignment.comparable).toBe(false);
    expect(alignment.basis).toBe('none');
    expect(alignment.origin).toBeNull();
    // The reason must name both origins: "incomparable" without saying why is unactionable.
    expect(alignment.reason).toContain('BOOT');
    expect(alignment.reason).toContain('ARM');
  });

  it('combines two stated synchronisation uncertainties in quadrature', () => {
    const alignment = resolveTimeAlignment(boot(0.3), boot(0.4));

    // sqrt(0.3^2 + 0.4^2) = 0.5, the 3-4-5 triangle, so an arithmetic sum (0.7) is visibly wrong.
    expect(alignment.syncUncertaintySeconds).toBeCloseTo(0.5, 12);
  });

  it('keeps a claimed perfect synchronisation as 0 rather than folding it into unknown', () => {
    const alignment = resolveTimeAlignment(boot(0), boot(0));

    expect(alignment.syncUncertaintySeconds).toBe(0);
  });

  it('reports unstated synchronisation as null, not as zero', () => {
    const alignment = resolveTimeAlignment(boot(0.2), boot(null));

    expect(alignment.syncUncertaintySeconds).toBeNull();
  });

  it('still aligns on elapsed time when synchronisation to UTC is unstated', () => {
    // Elapsed-basis comparison does not need a shared wall clock; it needs both zeros to mean the
    // same event, which a matching origin asserts. Conflating the two would refuse comparisons that
    // are perfectly well defined.
    const alignment = resolveTimeAlignment(boot(null), boot(null));

    expect(alignment.comparable).toBe(true);
    expect(alignment.syncUncertaintySeconds).toBeNull();
  });

  it('says what an elapsed alignment does and does not establish', () => {
    const alignment = resolveTimeAlignment(boot(), boot());

    // A difference at t is as much a difference in mission phase as in vehicle behaviour, and the
    // report has to say so rather than let a reader assume a synchronised clock.
    expect(alignment.reason).toMatch(/elapsed/i);
    expect(alignment.reason).not.toBe('');
  });
});
