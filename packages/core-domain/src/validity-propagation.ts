/**
 * Validity propagation — 05_IMPLEMENTATION_ROADMAP.md Phase A, 02_CANONICAL_DATA_MODEL.md §3
 * invariants 1a/1b, ADR-0007.
 *
 * When several input samples contribute to one output sample — resampling, alignment, any derived
 * signal — the output's validity is the least trustworthy contribution. Taking the *best* instead
 * would let a missing reading vanish behind a valid neighbour, which is exactly the coercion
 * doc 04 §1 rule 6 forbids.
 */
import { Validity } from '@pandalog/schema';

/**
 * Validity states ordered least-trustworthy first.
 *
 *   UNSUPPORTED   the source cannot provide this signal at all
 *   MISSING       nothing was logged at this instant
 *   INVALID       something was logged, but it failed a declared sanity check
 *   INTERPOLATED  a number computed from neighbouring samples, not measured
 *   VALID         a measurement
 *
 * The two value-bearing states (doc 02 §3 invariant 1a) sit at the top, so combining anything
 * value-bearing with anything non-value-bearing yields a non-value-bearing result — which is what
 * keeps invariants 1a/1b satisfiable under propagation.
 */
export const VALIDITY_TRUST_ORDER: readonly Validity[] = Object.freeze([
  Validity.UNSUPPORTED,
  Validity.MISSING,
  Validity.INVALID,
  Validity.INTERPOLATED,
  Validity.VALID,
]);

const TRUST_RANK: ReadonlyMap<Validity, number> = new Map(
  VALIDITY_TRUST_ORDER.map((validity, rank) => [validity, rank]),
);

/**
 * Combine the validities of every sample contributing to one output sample.
 *
 * An empty contribution set is `MISSING`, never `VALID`: nothing contributed, so nothing was
 * measured, and returning `VALID` would manufacture a measurement out of an absence.
 */
export function propagateValidity(contributions: Iterable<Validity>): Validity {
  let worst: Validity | null = null;
  let worstRank = Number.POSITIVE_INFINITY;

  for (const validity of contributions) {
    const rank = TRUST_RANK.get(validity);
    if (rank === undefined) {
      // Not reachable through the type system; guarded because this runs over decoded data.
      return Validity.INVALID;
    }
    if (rank < worstRank) {
      worstRank = rank;
      worst = validity;
    }
  }

  return worst ?? Validity.MISSING;
}
