/**
 * Browsing findings: filtering, searching and grouping them for display.
 *
 * A rule that fires on every excursion produces one Finding per excursion, which is right (doc 03
 * §2) and unreadable. A real log put 43 findings on this list, twenty-odd of them the same sentence
 * with different numbers, and a flat list of 43 is a list an engineer scrolls past rather than
 * reads.
 *
 * Grouping is `@pandalog/reporting`'s `groupFindings` — deliberately not a second implementation.
 * The screen and the report must group identically, or an engineer who found something on screen
 * would go looking for it in the report and find a different shape. Reporting owns the rule; this
 * module adds the part a report has no use for: an interactive filter over it.
 *
 * **Filtering hides findings, and the caller is told so.** `matchCount` and `totalCount` are both
 * returned so the view can say "12 of 43" rather than presenting a filtered list as the whole
 * truth. A findings list that quietly showed a subset would be the analysis equivalent of coercing
 * missing data to zero (doc 04 §1 rule 6) — the reader cannot tell that anything is absent.
 */
import { groupFindings, type FindingGroup } from '@pandalog/reporting';
import type { Finding, Severity } from '@pandalog/analysis';

import type { FindingAtTime } from './investigation.js';

/** Worst first — the order the rail, the summary and the report all use. */
export const SEVERITY_ORDER: readonly Severity[] = Object.freeze([
  'CRITICAL',
  'WARNING',
  'ADVISORY',
  'INFO',
]);

export interface FindingFilter {
  /** Severities to keep. Empty means every severity — "no filter", not "nothing". */
  readonly severities: readonly Severity[];
  /** Rule ids to keep. Empty means every rule. */
  readonly ruleIds: readonly string[];
  /** Free text matched against the statement, rule id, severity and cited signal ids. */
  readonly query: string;
}

export const NO_FILTER: FindingFilter = Object.freeze({
  severities: Object.freeze([]),
  ruleIds: Object.freeze([]),
  query: '',
});

export interface FindingGroupView {
  readonly group: FindingGroup;
  /** The group's findings in flight order, carrying the start time the list is sorted by. */
  readonly entries: readonly FindingAtTime[];
}

export interface FindingsBrowse {
  readonly groups: readonly FindingGroupView[];
  /** How many findings the filter kept. */
  readonly matchCount: number;
  /** How many there are in total, so a filtered view can never read as the whole set. */
  readonly totalCount: number;
  /** Severities actually present, for building a filter that offers only real choices. */
  readonly availableSeverities: readonly Severity[];
  readonly availableRuleIds: readonly string[];
  /** True when the filter is hiding something. */
  readonly isFiltered: boolean;
}

/** Signal ids a finding's evidence names. Event references name none. */
function citedSignalIds(finding: Finding): string[] {
  const ids = new Set<string>();
  for (const reference of finding.evidence) {
    if (reference.kind === 'signal-window' || reference.kind === 'measurement') {
      ids.add(reference.signalId);
    }
  }
  return [...ids];
}

/**
 * The text a search runs against.
 *
 * Statement, rule, severity and signals — the four things an engineer types when looking for
 * something they half-remember. Measurements are excluded on purpose: matching "0.34" against a
 * value would make a search for a number return findings whose *thresholds* contain it, which is a
 * different question from the one being asked.
 */
const searchableText = (finding: Finding): string =>
  [finding.statement, finding.ruleId, finding.severity, ...citedSignalIds(finding)]
    .join(' ')
    .toLowerCase();

function matches(finding: Finding, filter: FindingFilter): boolean {
  if (filter.severities.length > 0 && !filter.severities.includes(finding.severity)) {
    return false;
  }
  if (filter.ruleIds.length > 0 && !filter.ruleIds.includes(finding.ruleId)) {
    return false;
  }
  const query = filter.query.trim().toLowerCase();
  return query.length === 0 || searchableText(finding).includes(query);
}

const bySeverityOrder = (a: Severity, b: Severity): number =>
  SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);

/**
 * Filter, then group, then order each group's findings by time.
 *
 * Filtering before grouping is the meaningful order: a group's count then describes what is on
 * screen. Grouping first and filtering within would leave a heading saying "24 occurrences" above
 * three rows, which is a count of something the reader cannot see.
 */
export function browseFindings(
  entries: readonly FindingAtTime[],
  filter: FindingFilter = NO_FILTER,
): FindingsBrowse {
  const byId = new Map(entries.map((entry) => [entry.finding.id, entry]));
  const kept = entries.filter((entry) => matches(entry.finding, filter));

  const groups = groupFindings(kept.map((entry) => entry.finding)).map((group) => ({
    group,
    entries: group.findings
      .map((finding) => byId.get(finding.id))
      .filter((entry): entry is FindingAtTime => entry !== undefined)
      .sort(
        (a, b) =>
          a.startSeconds - b.startSeconds || a.finding.id.localeCompare(b.finding.id),
      ),
  }));

  const severities = new Set<Severity>();
  const ruleIds = new Set<string>();
  for (const entry of entries) {
    severities.add(entry.finding.severity);
    ruleIds.add(entry.finding.ruleId);
  }

  return {
    groups,
    matchCount: kept.length,
    totalCount: entries.length,
    availableSeverities: [...severities].sort(bySeverityOrder),
    availableRuleIds: [...ruleIds].sort(),
    isFiltered: kept.length !== entries.length,
  };
}

/** Toggle one value in a filter list, returning a new filter (no mutation — doc 04 §3). */
export function toggleSeverity(filter: FindingFilter, severity: Severity): FindingFilter {
  return {
    ...filter,
    severities: filter.severities.includes(severity)
      ? filter.severities.filter((entry) => entry !== severity)
      : [...filter.severities, severity],
  };
}

export function toggleRuleId(filter: FindingFilter, ruleId: string): FindingFilter {
  return {
    ...filter,
    ruleIds: filter.ruleIds.includes(ruleId)
      ? filter.ruleIds.filter((entry) => entry !== ruleId)
      : [...filter.ruleIds, ruleId],
  };
}

export const withQuery = (filter: FindingFilter, query: string): FindingFilter => ({
  ...filter,
  query,
});
