/**
 * Findings and verification results as CSV.
 *
 * A spreadsheet is where a flight-test engineer sorts, filters and pivots, and no amount of
 * markdown replaces that. The same rule applies as everywhere else in this package: every cell is a
 * value the artifacts already carry (doc 04 §7). Nothing is summed, averaged or rounded — full
 * precision goes out, because a report is an archived record and a CSV rounded to two places cannot
 * reproduce the finding it describes.
 *
 * One row per **evidence reference**, not per finding. A finding with four evidence refs becomes
 * four rows carrying the same finding id, which is what makes the evidence chain survive the trip
 * into a spreadsheet: collapsing it into one row would need the references joined into a single
 * cell, and a cell nobody can filter on is a cell nobody uses.
 *
 * RFC 4180 quoting, and it is not optional here: a rule's statement contains commas, and a
 * threshold basis can contain a quotation mark. A CSV that shifted a column under a comma would put
 * a severity in the units field, which is the kind of corruption a reader trusts silently.
 */
import type { EvidenceRef } from '@pandalog/analysis';

import type { ReportDocument } from './document.js';

/**
 * A number at full precision, or an explicit absence.
 *
 * Deliberately **not** `format.ts`'s `formatNumber`, which rounds to six significant figures for
 * readability. Prose is read; a CSV is computed on. A peak of 0.17453292519943295 written as
 * 0.174533 is an archived record that can no longer reproduce the finding it describes, and the
 * error would reappear in whatever the spreadsheet calculates next.
 *
 * A non-finite value is written as text rather than left blank: an empty cell is indistinguishable
 * from a missing column and reads as zero (doc 04 §1 rule 6).
 */
const rawNumber = (value: number): string =>
  Number.isFinite(value) ? String(value) : 'not recorded';

/** RFC 4180: quote when the value contains a delimiter, a quote or a newline; double inner quotes. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const row = (cells: readonly string[]): string => cells.map(csvCell).join(',');

/**
 * CRLF line endings, per RFC 4180.
 *
 * Chosen over LF because the consumer is a spreadsheet rather than a diff, and Excel's importer is
 * the least forgiving thing this file will meet.
 */
const CRLF = '\r\n';

const toCsv = (headers: readonly string[], rows: readonly (readonly string[])[]): string =>
  [row(headers), ...rows.map(row)].join(CRLF) + CRLF;

/** One evidence reference, flattened into the four columns a spreadsheet can filter on. */
function evidenceCells(reference: EvidenceRef | undefined): readonly string[] {
  if (reference === undefined) {
    // A finding with no evidence cannot exist (doc 03 §3), but a verification result citing none
    // can — and it is recorded INCONCLUSIVE, which the row still has to be able to say.
    return ['', '', '', ''];
  }
  switch (reference.kind) {
    case 'signal-window':
      return [
        reference.kind,
        reference.signalId,
        rawNumber(reference.t_start_seconds),
        rawNumber(reference.t_end_seconds),
      ];
    case 'measurement':
      return [
        reference.kind,
        reference.signalId,
        rawNumber(reference.t_seconds),
        rawNumber(reference.t_seconds),
      ];
    case 'event':
      return [reference.kind, reference.eventId, '', ''];
  }
}

/**
 * Every finding, one row per evidence reference.
 *
 * Measurements and thresholds are joined into one cell each rather than exploded into further rows:
 * crossing evidence with measurements would multiply the rows and make a count of "how many
 * findings" impossible to read off the file.
 */
export function renderFindingsCsv(document: ReportDocument): string {
  const rows = document.findings.flatMap((finding) => {
    const base = [
      finding.id,
      finding.ruleId,
      finding.ruleVersion,
      finding.severity,
      finding.statement,
      finding.measurements
        .map((entry) => `${entry.label}=${rawNumber(entry.value)} ${entry.unit}`)
        .join('; '),
      finding.thresholds
        .map(
          (entry) =>
            `${entry.label}=${rawNumber(entry.value)} ${entry.unit} (basis ${entry.basis})`,
        )
        .join('; '),
      finding.producedAtUtc,
    ];

    return finding.evidence.length === 0
      ? [[...base, ...evidenceCells(undefined)]]
      : finding.evidence.map((reference) => [...base, ...evidenceCells(reference)]);
  });

  return toCsv(
    [
      'finding_id',
      'rule_id',
      'rule_version',
      'severity',
      'statement',
      'measurements',
      'thresholds',
      'produced_at_utc',
      'evidence_kind',
      'evidence_target',
      'evidence_start_seconds',
      'evidence_end_seconds',
    ],
    rows,
  );
}

/**
 * Every requirement outcome, one row per evidence reference.
 *
 * A result citing no evidence still gets a row, with the evidence columns empty. Omitting it would
 * hide exactly the case doc 03 §3 exists for — a requirement that reached INCONCLUSIVE because
 * nothing supported it is the row an engineer most needs to see.
 */
export function renderVerificationCsv(document: ReportDocument): string {
  const rows = document.verification.results.flatMap((result) => {
    const base = [
      result.requirementId,
      result.requirementVersion,
      result.outcome,
      result.reason,
      document.verification.requirementSetId,
      document.verification.requirementSetVersion,
      document.verification.requirementSetSource,
    ];

    return result.evidence.length === 0
      ? [[...base, ...evidenceCells(undefined)]]
      : result.evidence.map((reference) => [...base, ...evidenceCells(reference)]);
  });

  return toCsv(
    [
      'requirement_id',
      'requirement_version',
      'outcome',
      'reason',
      'requirement_set_id',
      'requirement_set_version',
      'requirement_set_source',
      'evidence_kind',
      'evidence_target',
      'evidence_start_seconds',
      'evidence_end_seconds',
    ],
    rows,
  );
}
