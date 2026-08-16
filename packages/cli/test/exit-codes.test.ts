/**
 * Exit-code policy — doc 05 Phase G: "Exit codes reflecting verification outcome where relevant
 * (e.g. non-zero on any FAIL), so the CLI is usable in CI for a user's own flight-test pipeline."
 *
 * The property that matters is the one a CI pipeline relies on: **exit 0 means every requirement
 * was actually checked and passed.** Two states tempt an implementation into a false 0 and neither
 * is allowed to have it — a flight nothing could be concluded about, and a flight where every
 * requirement turned out not to apply. In both, nothing was verified, and a green pipeline would be
 * telling the engineer something PandaLog does not know.
 */
import { describe, expect, it } from 'vitest';

import { EXIT, exitCodeFor } from '@pandalog/cli';
import type { VerificationOutcome } from '@pandalog/verification';

const summary = (patch: Partial<Record<VerificationOutcome, number>>) => ({
  PASS: 0,
  FAIL: 0,
  INCONCLUSIVE: 0,
  NOT_APPLICABLE: 0,
  ...patch,
});

describe('exitCodeFor', () => {
  it('is 0 when every requirement passed', () => {
    expect(exitCodeFor(summary({ PASS: 4 }))).toBe(EXIT.OK);
  });

  it('is 0 when the requirements that applied all passed', () => {
    expect(exitCodeFor(summary({ PASS: 2, NOT_APPLICABLE: 2 }))).toBe(EXIT.OK);
  });

  it('is non-zero on any FAIL', () => {
    expect(exitCodeFor(summary({ PASS: 3, FAIL: 1 }))).toBe(EXIT.FAIL);
  });

  it('reports FAIL ahead of INCONCLUSIVE — the worse answer wins', () => {
    expect(exitCodeFor(summary({ FAIL: 1, INCONCLUSIVE: 3 }))).toBe(EXIT.FAIL);
  });

  it('is non-zero when anything was inconclusive', () => {
    expect(exitCodeFor(summary({ PASS: 3, INCONCLUSIVE: 1 }))).toBe(EXIT.INCONCLUSIVE);
  });

  it('is non-zero when nothing applied, because nothing was verified', () => {
    expect(exitCodeFor(summary({ NOT_APPLICABLE: 4 }))).toBe(EXIT.INCONCLUSIVE);
  });

  it('is non-zero for an empty report', () => {
    expect(exitCodeFor(summary({}))).toBe(EXIT.INCONCLUSIVE);
  });

  it('never returns 0 unless at least one requirement passed', () => {
    const cases = [
      summary({ FAIL: 1 }),
      summary({ INCONCLUSIVE: 1 }),
      summary({ NOT_APPLICABLE: 1 }),
      summary({ INCONCLUSIVE: 1, NOT_APPLICABLE: 1 }),
      summary({}),
    ];

    for (const outcome of cases) {
      expect(exitCodeFor(outcome), JSON.stringify(outcome)).not.toBe(EXIT.OK);
    }
  });

  it('keeps usage and input failures out of the verification range', () => {
    // sysexits.h values, so 0-2 stay free to mean "what the verification concluded".
    expect([EXIT.USAGE, EXIT.INPUT, EXIT.INTERNAL]).toEqual([64, 65, 70]);
  });
});
