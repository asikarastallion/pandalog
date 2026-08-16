/**
 * Exit codes — 05_IMPLEMENTATION_ROADMAP.md Phase G.
 *
 * A CI pipeline reads one thing from this tool: the exit status. So the contract is stated as a
 * property rather than a mapping — **exit 0 means every requirement that applied was checked and
 * passed**, and nothing else may produce it.
 *
 * Two states look like success and are not. A flight where every requirement was INCONCLUSIVE was
 * not verified; a flight where every requirement was NOT_APPLICABLE was not verified either. Both
 * exit 2. A pipeline that went green on those would be reporting confidence PandaLog does not have,
 * which is the same failure the verification package exists to prevent — here it would just be
 * expressed as a number instead of a word.
 *
 * Operational failures use sysexits.h values so 0-2 stay reserved for what the verification
 * concluded, and a CI script can tell "the aircraft failed" from "the tool could not run".
 */
import type { VerificationOutcome } from '@pandalog/verification';

export const EXIT = Object.freeze({
  /** Every applicable requirement passed. */
  OK: 0,
  /** At least one requirement failed. */
  FAIL: 1,
  /** Nothing failed, but nothing was conclusively verified either. */
  INCONCLUSIVE: 2,
  /** The command line could not be understood (EX_USAGE). */
  USAGE: 64,
  /** The log could not be read or parsed (EX_DATAERR). */
  INPUT: 65,
  /** An unexpected internal failure (EX_SOFTWARE). */
  INTERNAL: 70,
});

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Map a verification report's outcome counts onto the process exit status. */
export function exitCodeFor(summary: Readonly<Record<VerificationOutcome, number>>): ExitCode {
  if (summary.FAIL > 0) {
    return EXIT.FAIL;
  }
  if (summary.INCONCLUSIVE > 0 || summary.PASS === 0) {
    return EXIT.INCONCLUSIVE;
  }
  return EXIT.OK;
}
