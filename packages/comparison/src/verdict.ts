/**
 * The three answers a comparison can give.
 *
 * `INCOMPARABLE` is to this package what `INCONCLUSIVE` is to `@pandalog/verification`, and it
 * exists for the same reason. Two flights can fail to be comparable in ways that leave every
 * function returning normally: different time origins, a signal in different units, two reports
 * answering different requirement sets, a window in which neither side logged anything usable.
 * Every one of those would collapse into "no material difference" under a boolean, and a reader
 * cannot tell a comparison that found nothing from one that never ran.
 *
 * So the rule this package is built around, stated once:
 *
 * > **An axis that was not compared is never reported as showing no difference.**
 */
export type ComparisonVerdict = 'SAME' | 'DIFFERENT' | 'INCOMPARABLE';

/**
 * Roll several verdicts into one.
 *
 * `DIFFERENT` wins over everything: a difference that was actually established stays visible even
 * when another axis could not be checked. `INCOMPARABLE` then wins over `SAME`, because sameness
 * across the whole comparison is a claim about all of it. An empty list is `INCOMPARABLE` — nothing
 * was examined, so nothing was found to agree.
 */
export function combineVerdicts(verdicts: readonly ComparisonVerdict[]): ComparisonVerdict {
  if (verdicts.includes('DIFFERENT')) {
    return 'DIFFERENT';
  }
  if (verdicts.length === 0 || verdicts.includes('INCOMPARABLE')) {
    return 'INCOMPARABLE';
  }
  return 'SAME';
}
