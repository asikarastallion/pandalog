/**
 * Assembling a report document.
 *
 * Every artifact is passed through by reference. The only new values this module produces are the
 * generation timestamp, the title, and counts of the lists it was handed — and a count of a list
 * being rendered is rendering, which is the line doc 04 §7 draws. There is no arithmetic here
 * beyond `+= 1`, and that is not an accident of the current implementation but the point of it.
 */
import type { Finding, Severity } from '@pandalog/analysis';
import { datasetTimeSpan } from '@pandalog/core-domain';

import {
  REPORTING_VERSION,
  type ReportCounts,
  type ReportDocument,
  type ReportInput,
  type ReportProvenance,
} from './document.js';
import { ReportingError } from './errors.js';

const SEVERITIES: readonly Severity[] = ['INFO', 'ADVISORY', 'WARNING', 'CRITICAL'];

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function tally(findings: readonly Finding[]): Readonly<Record<Severity, number>> {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    Severity,
    number
  >;
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return Object.freeze(counts);
}

function provenanceOf(input: ReportInput): ReportProvenance {
  return Object.freeze({
    source: input.dataset.provenance,
    schemaVersion: input.dataset.schemaVersion,
    vehicle: input.dataset.vehicle,
    reportingVersion: REPORTING_VERSION,
    rules: input.executedRules,
    requirementSet: Object.freeze({
      id: input.verification.requirementSetId,
      version: input.verification.requirementSetVersion,
      source: input.verification.requirementSetSource,
    }),
    comparisonTolerances: input.comparison?.tolerances ?? null,
  });
}

/**
 * Build a report document from one flight's artifacts.
 *
 * @throws {ReportingError} INVALID_INPUT when the clock does not yield a usable UTC instant — a
 * report stamped `Invalid Date` is worse than one that failed to generate, because it looks filed.
 */
export function buildReport(input: ReportInput): ReportDocument {
  // Checked before `toISOString`, which throws a bare RangeError on an invalid Date — an error
  // from inside the standard library, carrying no code and naming neither this package nor the
  // clock that caused it (doc 04 §4).
  const generated = input.now();
  const generatedAtUtc = Number.isNaN(generated.getTime()) ? '' : generated.toISOString();

  if (!ISO_UTC_RE.test(generatedAtUtc)) {
    throw new ReportingError(
      'INVALID_INPUT',
      'The clock supplied to buildReport did not yield an ISO-8601 UTC instant, so this report ' +
        'cannot be stamped. A report stamped `Invalid Date` is worse than one that failed to ' +
        'generate, because it looks filed.',
      { generatedAtUtc },
    );
  }

  const counts: ReportCounts = Object.freeze({
    findings: input.findings.length,
    findingsBySeverity: tally(input.findings),
    // The verification report already counted its own outcomes. Counting them again here would be
    // a second implementation of one number, and two implementations are how a report starts
    // disagreeing with the result it reports.
    outcomes: input.verification.summary,
  });

  return Object.freeze({
    title: input.title ?? `Flight analysis — ${input.dataset.provenance.fileName}`,
    generatedAtUtc,
    provenance: provenanceOf(input),
    counts,
    findings: input.findings,
    hypotheses: input.hypotheses,
    events: input.events ?? [],
    timeSpan: datasetTimeSpan(input.dataset),
    notApplicableRuleIds: input.notApplicableRuleIds,
    verification: input.verification,
    comparison: input.comparison ?? null,
  });
}
