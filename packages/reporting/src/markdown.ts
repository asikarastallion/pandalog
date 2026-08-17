/**
 * The rendered report.
 *
 * Markdown because a report is an archived artifact: it diffs in review, reads without a tool, and
 * needs no dependency to produce — which matters for a package that must run unchanged in a browser
 * Worker and in Node (doc 01 §3 rule 3).
 *
 * Nothing here decides anything. Every severity, outcome, verdict and number comes from the
 * document, and the renderer's whole job is to lay them out and refuse to round away the parts that
 * carry meaning: an `INCONCLUSIVE` is printed as `INCONCLUSIVE`, a threshold is printed with its
 * basis, and an unrecorded quantity is printed as "not recorded" rather than as a blank cell that
 * reads like a zero.
 */
import type { EvidenceRef, Finding, Hypothesis } from '@pandalog/analysis';
import type { ComparisonReport, ComparisonVerdict } from '@pandalog/comparison';
import type { VerificationResult } from '@pandalog/verification';

import type { ReportDocument } from './document.js';
import { code, formatNumber, formatQuantity, formatWindow, orNotLogged, table } from './format.js';

const section = (heading: string, body: string): string => `## ${heading}\n\n${body}`;

function renderEvidence(reference: EvidenceRef): string {
  switch (reference.kind) {
    case 'signal-window':
      return `signal ${code(reference.signalId)}, ${formatWindow(reference.t_start_seconds, reference.t_end_seconds)}`;
    case 'event':
      return `event ${code(reference.eventId)}`;
    case 'measurement':
      return (
        `measurement on ${code(reference.signalId)} at ${formatNumber(reference.t_seconds)} s: ` +
        formatQuantity(reference.value, reference.unit)
      );
  }
}

function renderFinding(finding: Finding): string {
  const lines = [`### ${code(finding.ruleId)} — ${finding.severity}`, '', finding.statement, ''];

  if (finding.measurements.length > 0) {
    lines.push('Measurements:', '');
    for (const measurement of finding.measurements) {
      lines.push(`- ${measurement.label}: ${formatQuantity(measurement.value, measurement.unit)}`);
    }
    lines.push('');
  }

  if (finding.thresholds.length > 0) {
    lines.push('Thresholds:', '');
    for (const threshold of finding.thresholds) {
      // The basis is never optional here. A threshold printed alone reads as a settled criterion,
      // and every threshold in this repository is provisional (doc 03 §4).
      lines.push(
        `- ${threshold.label}: ${formatQuantity(threshold.value, threshold.unit)} ` +
          `(basis ${code(threshold.basis)})`,
      );
    }
    lines.push('');
  }

  lines.push('Evidence:', '');
  for (const reference of finding.evidence) {
    lines.push(`- ${renderEvidence(reference)}`);
  }
  lines.push('', `Rule ${code(finding.ruleId)} version ${code(finding.ruleVersion)}.`);

  return lines.join('\n');
}

function renderHypothesis(hypothesis: Hypothesis): string {
  const lines = [
    `### ${hypothesis.status} — ${hypothesis.statement}`,
    '',
    `Related findings: ${
      hypothesis.relatedFindingIds.length === 0
        ? 'none'
        : hypothesis.relatedFindingIds.map(code).join(', ')
    }`,
  ];

  if (hypothesis.supportingEvidence.length > 0) {
    lines.push('', 'Supporting evidence:', '');
    for (const reference of hypothesis.supportingEvidence) {
      lines.push(`- ${renderEvidence(reference)}`);
    }
  }

  return lines.join('\n');
}

function renderOutcome(result: VerificationResult): string {
  const lines = [
    `### ${code(result.requirementId)} — ${result.outcome}`,
    '',
    result.reason,
    '',
    `Requirement version ${code(result.requirementVersion)}.`,
  ];

  if (result.evidence.length > 0) {
    lines.push('', 'Evidence:', '');
    for (const reference of result.evidence) {
      lines.push(`- ${renderEvidence(reference)}`);
    }
  }

  return lines.join('\n');
}

const axisRow = (name: string, verdict: ComparisonVerdict, reason: string): readonly string[] => [
  name,
  verdict,
  reason,
];

function renderComparison(comparison: ComparisonReport): string {
  const lines = [
    `Baseline ${code(comparison.baselineLabel)} against subject ${code(comparison.subjectLabel)}.`,
    '',
    `Overall: ${comparison.verdict}`,
    '',
    // ADR-0012: three verdict states, never collapsed into a pass/fail pair. An axis nobody could
    // check is not an axis that agreed, and the table is where a reader would otherwise assume it.
    table(
      ['Axis', 'Verdict', 'Basis'],
      [
        axisRow('Signals', comparison.signals.verdict, comparison.signals.reason),
        axisRow('Events', comparison.events.verdict, comparison.events.reason),
        axisRow('Findings', comparison.findings.verdict, comparison.findings.reason),
        axisRow('Verification', comparison.verification.verdict, comparison.verification.reason),
      ],
      'No axis was compared.',
    ),
    '',
    `Time alignment: ${comparison.alignment.reason}`,
  ];

  const { regressions, improvements } = comparison.verification;
  const named = (ids: readonly string[]): string =>
    ids.length === 0 ? 'none' : ids.map(code).join(', ');

  lines.push(
    '',
    `- Requirements that regressed: ${named(regressions)}`,
    `- Requirements that improved: ${named(improvements)}`,
  );

  if (comparison.signals.incomparable.length > 0) {
    // ADR-0012: a `SAME` beside a long list here is a much weaker statement than a `SAME` beside an
    // empty one, so the list is printed rather than left to be recovered from the axis verdict.
    lines.push(`- Signals that could not be compared: ${named(comparison.signals.incomparable)}`);
  }

  return lines.join('\n');
}

/** Render a report document as Markdown. */
export function renderMarkdown(document: ReportDocument): string {
  const { provenance, counts } = document;

  const sections: string[] = [
    `# ${document.title}`,
    `Generated ${code(document.generatedAtUtc)}. This timestamp is the only part of a report that ` +
      'changes between two runs over the same inputs and versions.',

    section(
      'Source',
      table(
        ['Field', 'Value'],
        [
          ['File', code(provenance.source.fileName)],
          ['SHA-256', code(provenance.source.sha256)],
          ['Size', `${formatNumber(provenance.source.sizeBytes)} bytes`],
          ['Format', code(provenance.source.format)],
          [
            'Parser',
            `${code(provenance.source.parserPackage)} ${code(provenance.source.parserVersion)}`,
          ],
          ['Ingested', code(provenance.source.ingestedAtUtc)],
          ['Canonical model', code(provenance.schemaVersion)],
          ['Reporting', code(provenance.reportingVersion)],
          ['Frame class', orNotLogged(provenance.vehicle.frameClass)],
          ['Firmware', orNotLogged(provenance.vehicle.firmwareVersion)],
          ['Firmware hash', orNotLogged(provenance.vehicle.firmwareHash)],
        ],
        'No provenance was recorded.',
      ),
    ),

    section(
      'Rules applied',
      table(
        ['Rule', 'Version', 'Applied to this flight'],
        provenance.rules.map((rule) => [
          code(rule.id),
          code(rule.version),
          rule.applied ? 'yes' : 'no',
        ]),
        'No analysis rules were registered.',
      ) +
        '\n\nA rule that applied and found nothing is not the same as a rule that did not apply; ' +
        'both are listed so the report says what the flight was actually checked against.',
    ),

    section(
      'Summary',
      [
        `Findings: ${formatNumber(counts.findings)} ` +
          `(CRITICAL ${formatNumber(counts.findingsBySeverity.CRITICAL)}, ` +
          `WARNING ${formatNumber(counts.findingsBySeverity.WARNING)}, ` +
          `ADVISORY ${formatNumber(counts.findingsBySeverity.ADVISORY)}, ` +
          `INFO ${formatNumber(counts.findingsBySeverity.INFO)})`,
        '',
        `Verification against ${code(provenance.requirementSet.id)} version ` +
          `${code(provenance.requirementSet.version)}, source ${code(provenance.requirementSet.source)}: ` +
          `PASS ${formatNumber(counts.outcomes.PASS)}, FAIL ${formatNumber(counts.outcomes.FAIL)}, ` +
          `INCONCLUSIVE ${formatNumber(counts.outcomes.INCONCLUSIVE)}, ` +
          `NOT_APPLICABLE ${formatNumber(counts.outcomes.NOT_APPLICABLE)}.`,
      ].join('\n'),
    ),

    section(
      'Findings',
      document.findings.length === 0
        ? 'This flight raised no findings. That is not a statement that nothing was wrong — it ' +
            'means no registered rule found a condition it was written to detect.'
        : document.findings.map(renderFinding).join('\n\n'),
    ),
  ];

  if (document.hypotheses.length > 0) {
    sections.push(
      section(
        'Hypotheses',
        'Unconfirmed explanations, offered to direct an investigation. None of these is ' +
          'established by its evidence; that is what makes it a hypothesis rather than a finding ' +
          '(doc 03 §1).\n\n' +
          document.hypotheses.map(renderHypothesis).join('\n\n'),
      ),
    );
  }

  sections.push(
    section(
      'Verification',
      document.verification.results.length === 0
        ? 'No requirements were evaluated.'
        : document.verification.results.map(renderOutcome).join('\n\n'),
    ),
  );

  if (document.verification.evidenceRuleViolations.length > 0) {
    sections.push(
      section(
        'Requirements that claimed more than they showed',
        'These requirements reported PASS or FAIL while citing no evidence. Their results were ' +
          'recorded INCONCLUSIVE (doc 03 §3); the implementations are defective and are named ' +
          'here rather than hidden: ' +
          document.verification.evidenceRuleViolations.map(code).join(', '),
      ),
    );
  }

  if (document.comparison !== null) {
    sections.push(section('Comparison', renderComparison(document.comparison)));
  }

  return `${sections.join('\n\n')}\n`;
}
