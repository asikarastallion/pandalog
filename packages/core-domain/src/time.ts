/**
 * TimeBase construction — 02_CANONICAL_DATA_MODEL.md §2, §3 invariants 3 and 6.
 *
 * Time normalisation lives here and nowhere else (doc 01 §7). The constructor's job is to make the
 * two states that matter unconfusable: "synchronisation is unknown" is `null`, and "synchronisation
 * is known to be perfect" is `0`. A default of `0` would quietly turn the first into the second.
 */
import { validateTimeBase, type TimeBase, type TimeOrigin } from '@pandalog/schema';

import { InvalidTimeBaseError } from './errors.js';

export interface CreateTimeBaseInput {
  readonly origin: TimeOrigin;
  /** Wall-clock UTC instant at t_rel_seconds = 0. Omit or pass null when unknown. */
  readonly epochUtc?: string | null;
  /**
   * One-sigma uncertainty against UTC truth, in seconds. Omit or pass null when unestablished;
   * pass 0 only as a positive claim (e.g. a GPS-disciplined clock).
   */
  readonly syncUncertaintySeconds?: number | null;
  /** True only if the source itself declares a uniform sample interval. */
  readonly uniformlySampled?: boolean;
}

/**
 * Build a validated, frozen `TimeBase`.
 *
 * @throws {InvalidTimeBaseError} when the result would violate doc 02's structural rules, or when
 * the origin is `UTC_EPOCH` without an epoch to anchor it to.
 */
export function createTimeBase(input: CreateTimeBaseInput): TimeBase {
  const candidate: TimeBase = {
    origin: input.origin,
    epochUtc: input.epochUtc ?? null,
    syncUncertaintySeconds: input.syncUncertaintySeconds ?? null,
    uniformlySampled: input.uniformlySampled ?? false,
  };

  // The schema owns the structural rules; core-domain calls them rather than restating them.
  const issues = validateTimeBase(candidate);
  if (issues.length > 0) {
    throw new InvalidTimeBaseError(
      `Cannot construct a TimeBase: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
      { issues, candidate },
    );
  }

  // A construction-time rule beyond the structural ones: UTC_EPOCH claims the axis is
  // UTC-referenced, which is unresolvable without the instant it is referenced to.
  if (candidate.origin === 'UTC_EPOCH' && candidate.epochUtc === null) {
    throw new InvalidTimeBaseError(
      'A UTC_EPOCH time base requires epochUtc; without it the axis cannot be resolved to UTC.',
      { candidate },
    );
  }

  return Object.freeze(candidate);
}
