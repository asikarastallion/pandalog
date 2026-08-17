/**
 * Grouping, ordered.
 *
 * Both the event and the finding comparators need the same thing: items bucketed by a key, each
 * bucket in a stable order that does not depend on the order the caller handed them over. That
 * independence is load-bearing rather than tidy — matching two timelines by arrival order would
 * report changes that are artefacts of iteration, and doc 03 §6 requires two runs over the same
 * inputs to produce identical output.
 */
export function groupSorted<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  compare: (a: T, b: T) => number,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }

  for (const group of groups.values()) {
    group.sort(compare);
  }

  return groups;
}
