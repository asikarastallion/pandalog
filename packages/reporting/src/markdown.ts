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
import {
  evidenceTimeSpan,
  type EvidenceRef,
  type Finding,
  type Hypothesis,
  type ThresholdRecord,
} from '@pandalog/analysis';
import type { ComparisonReport, ComparisonVerdict } from '@pandalog/comparison';
import { modeSegments, type ModeSegment } from '@pandalog/events';
import type { VerificationResult } from '@pandalog/verification';

import type { ReportDocument } from './document.js';
import { groupFindings, isRepeated, type FindingGroup } from './rollup.js';
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

/** One threshold line. The basis is never optional (doc 03 §4). */
const renderThreshold = (threshold: ThresholdRecord): string =>
  `- ${threshold.label}: ${formatQuantity(threshold.value, threshold.unit)} ` +
  `(basis ${code(threshold.basis)})`;

/**
 * Whether every finding in a group was judged against identical thresholds.
 *
 * When they were, the criteria are stated once for the group instead of twenty-four times. That is
 * a de-duplication of text, not of substance: if any occurrence were judged differently this
 * returns false and each one prints its own, because a reader must never have to assume that the
 * criterion in front of them is the one that produced the finding below it.
 */
function sharedThresholds(group: FindingGroup): readonly ThresholdRecord[] | null {
  const [first, ...rest] = group.findings;
  if (first === undefined || first.thresholds.length === 0) {
    return null;
  }
  const shape = (finding: Finding): string => JSON.stringify(finding.thresholds);
  const reference = shape(first);
  return rest.every((finding) => shape(finding) === reference) ? first.thresholds : null;
}

/**
 * One occurrence, under a group heading that already named the rule and severity.
 *
 * `hoistedThresholds` is true when the group printed the criteria once above; the occurrence then
 * omits them rather than repeating an identical block.
 */
function renderOccurrence(finding: Finding, hoistedThresholds: boolean): string {
  const span = evidenceTimeSpan(finding.evidence);
  const heading = `#### ${span === null ? code(finding.id) : formatWindow(span.startSeconds, span.endSeconds)}`;
  return [heading, '', renderBody(finding, hoistedThresholds)].join('\n');
}

/** Statement, measurements, thresholds and evidence — the substance, without a heading. */
function renderBody(finding: Finding, hoistedThresholds: boolean): string {
  const lines = [finding.statement, ''];

  if (finding.measurements.length > 0) {
    lines.push('Measurements:', '');
    for (const measurement of finding.measurements) {
      lines.push(`- ${measurement.label}: ${formatQuantity(measurement.value, measurement.unit)}`);
    }
    lines.push('');
  }

  if (!hoistedThresholds && finding.thresholds.length > 0) {
    lines.push('Thresholds:', '');
    for (const threshold of finding.thresholds) {
      lines.push(renderThreshold(threshold));
    }
    lines.push('');
  }

  lines.push('Evidence:', '');
  for (const reference of finding.evidence) {
    lines.push(`- ${renderEvidence(reference)}`);
  }
  lines.push(
    '',
    `Finding ${code(finding.id)}, rule ${code(finding.ruleId)} version ${code(finding.ruleVersion)}.`,
  );

  return lines.join('\n');
}

/**
 * A group of findings the same rule raised about the same signals at the same severity.
 *
 * Every occurrence is still printed in full underneath — doc 03 §3 makes each one a separate
 * evidenced claim and a report that summarised them away would be a report you cannot audit. What
 * the group adds is a way in: how many, over what span, and the largest value any of them recorded.
 *
 * There is no total. A summed duration is a quantity no Finding asserts (doc 04 §7); see
 * `rollup.ts` for why that belongs in `@pandalog/analysis` if it is ever wanted.
 */
function renderGroup(group: FindingGroup): string {
  const heading =
    group.signalIds.length === 0
      ? `### ${code(group.ruleId)} — ${group.severity}`
      : `### ${code(group.ruleId)} — ${group.severity} — ${group.signalIds.map(code).join(', ')}`;

  // A group of one is a finding, not a group. A per-occurrence sub-heading under a heading that
  // already identifies it would add a level of structure carrying no information.
  const [only] = group.findings;
  if (!isRepeated(group)) {
    return only === undefined ? heading : [heading, '', renderBody(only, false)].join('\n');
  }

  const lines = [heading, ''];

  lines.push(
    `${formatNumber(group.count)} occurrences` +
      (group.firstSeconds === null || group.lastSeconds === null
        ? ''
        : `, ${formatWindow(group.firstSeconds, group.lastSeconds)}`) +
      '. Each is a separate finding with its own evidence, listed below.',
    '',
  );

  if (group.peaks.length > 0) {
    lines.push('Largest value recorded across these occurrences:', '');
    for (const peak of group.peaks) {
      lines.push(
        `- ${peak.label}: ${formatQuantity(peak.value, peak.unit)} ` +
          `(finding ${code(peak.findingId)})`,
      );
    }
    lines.push('');
  }

  const hoisted = sharedThresholds(group);
  if (hoisted !== null) {
    lines.push('Thresholds, identical for every occurrence below:', '');
    for (const threshold of hoisted) {
      lines.push(renderThreshold(threshold));
    }
    lines.push('');
  }

  lines.push(`Rule ${code(group.ruleId)} version ${code(only?.ruleVersion ?? '')}.`, '');
  lines.push(
    group.findings.map((finding) => renderOccurrence(finding, hoisted !== null)).join('\n\n'),
  );

  return lines.join('\n');
}

/**
 * The index an engineer scans before reading anything.
 *
 * Every column is a tally or a selection from the findings themselves — no column is derived.
 */
function renderGroupIndex(groups: readonly FindingGroup[]): string {
  return table(
    ['Rule', 'Severity', 'Signals', 'Occurrences', 'Span', 'Largest recorded'],
    groups.map((group) => [
      code(group.ruleId),
      group.severity,
      group.signalIds.length === 0 ? '—' : group.signalIds.map(code).join(', '),
      formatNumber(group.count),
      group.firstSeconds === null || group.lastSeconds === null
        ? 'not time-bounded'
        : formatWindow(group.firstSeconds, group.lastSeconds),
      group.peaks.length === 0
        ? 'no measurement recorded'
        : group.peaks
            .map((peak) => `${peak.label} ${formatQuantity(peak.value, peak.unit)}`)
            .join('; '),
    ]),
    'No findings to index.',
  );
}

/**
 * The modes the aircraft flew in, as intervals.
 *
 * A reader placing a finding in the flight asks what mode it was in, and until now the report could
 * not answer. The intervals are `@pandalog/events`' (`modeSegments`) — the same ones the app colours
 * a ground track with, so the document and the screen cannot disagree about where a mode ended.
 *
 * Two honesty requirements, both from ADR-0016. A period the log never stated a mode for is printed
 * as "not recorded" rather than back-filled from the next record; and a mode is printed as its
 * *number*, because 5 is LOITER on a copter and FBWA on a plane and the frame class is often not
 * logged. Naming it from a guess would be wrong in a way the reader could not detect.
 */
function renderModes(segments: readonly ModeSegment[]): string {
  const rows = segments.map((segment) => [
    segment.mode === null ? 'not recorded' : formatNumber(segment.mode),
    formatWindow(segment.startSeconds, segment.endSeconds),
    segment.startsAtLoggedChange ? 'logged change' : 'start of data',
    segment.endsAtLoggedChange ? 'logged change' : 'end of data',
  ]);

  return (
    table(
      ['Mode', 'Interval', 'Began at', 'Ended at'],
      rows,
      'This log carries no mode records, so the flight cannot be divided into modes.',
    ) +
    '\n\nA mode is shown as the number the log recorded. The same number means different modes on ' +
    'different airframes — 5 is LOITER on a multirotor and FBWA on a fixed wing — and this log ' +
    'does not identify the airframe, so naming it would be a guess (ADR-0016). A boundary shown as ' +
    '`start of data` or `end of data` is where the recording began or ended, not a transition the ' +
    'aircraft made.'
  );
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
  const findingGroups = groupFindings(document.findings);

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
      'Flight modes',
      renderModes(
        document.timeSpan === null ? [] : modeSegments(document.events, document.timeSpan),
      ),
    ),

    section(
      'Findings',
      document.findings.length === 0
        ? 'This flight raised no findings. That is not a statement that nothing was wrong — it ' +
            'means no registered rule found a condition it was written to detect.'
        : [
            renderGroupIndex(findingGroups),
            '',
            'Findings are grouped by rule, severity and the signals their evidence names. Grouping ' +
              'is presentation only: every finding below is the one the analysis produced, with ' +
              'its own evidence, and no figure here is a total — a summed quantity would be a ' +
              'measurement no finding asserts (doc 04 §7).',
            '',
            findingGroups.map(renderGroup).join('\n\n'),
          ].join('\n'),
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
