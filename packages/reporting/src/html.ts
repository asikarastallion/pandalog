/**
 * The report as a standalone, printable HTML document.
 *
 * Markdown is the archival form: it diffs in review, reads without a tool, and is byte-reproducible.
 * What it cannot carry is a picture, and an engineer reads the shape of an altitude profile faster
 * than any paragraph describing it. So charts live here rather than being base64-encoded into the
 * markdown, where they would destroy both properties the markdown exists for.
 *
 * This is also the PDF path. There is no PDF library (doc 04 §9: convenience is not justification),
 * because the browser already has a typesetter — the page carries `@page` and print rules, and
 * "Save as PDF" from the print dialog produces the document. That has an honest limitation and it
 * is stated in the document itself rather than in a commit message: **the HTML is reproducible, the
 * PDF is not.** Two runs over one log at the same versions produce identical HTML; the PDF they
 * print to depends on the browser's font rasterisation, page size and margins, so it is a rendering
 * of the record rather than the record.
 *
 * Self-contained by construction: styles inline, charts inline as SVG, no font file, no script, no
 * external request. A report is emailed, printed and filed, and anything it has to fetch is
 * something it can lose.
 */
import type { Finding, Severity } from '@pandalog/analysis';
import { modeSegments } from '@pandalog/events';

import { renderChartSvg, modeFill, type Chart } from './chart.js';
import type { ReportDocument } from './document.js';
import { formatNumber, formatQuantity } from './format.js';
import type { ChartPanel } from './panels.js';
import { groupFindings, isRepeated, type FindingGroup } from './rollup.js';

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEVERITY_TONE: Readonly<Record<Severity, string>> = Object.freeze({
  CRITICAL: 'fail',
  WARNING: 'warn',
  ADVISORY: 'muted',
  INFO: 'muted',
});

/**
 * Print-first stylesheet.
 *
 * Light-on-white unconditionally: this is a document, and a dark page is a document that wastes a
 * cartridge. Page breaks are held off inside a finding so an evidence list is never split from the
 * claim it supports.
 */
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem; background: #fff; color: #16181d;
  font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 60rem; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .6rem; padding-bottom: .3rem; border-bottom: 1px solid #d8dbe2; }
h3 { font-size: .95rem; margin: 1.4rem 0 .4rem; }
h4 { font-size: .82rem; margin: 1rem 0 .3rem; color: #4a5060; font-weight: 600; }
p { margin: .4rem 0; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
table { border-collapse: collapse; width: 100%; margin: .6rem 0; font-size: .85rem; }
th, td { border: 1px solid #d8dbe2; padding: .35rem .5rem; text-align: left; vertical-align: top; }
th { background: #f4f5f8; font-weight: 600; }
ul { margin: .3rem 0; padding-left: 1.2rem; }
li { margin: .15rem 0; }
.lede { color: #4a5060; font-size: .85rem; }
.note { color: #4a5060; font-size: .8rem; line-height: 1.6; }
.tag { display: inline-block; padding: .05rem .4rem; border-radius: 3px; font-size: .72rem;
  font-weight: 600; letter-spacing: .04em; border: 1px solid currentColor; }
.fail { color: #b3261e; } .warn { color: #a4620a; } .pass { color: #1a7f45; } .muted { color: #4a5060; }
figure { margin: 0 0 1.1rem; break-inside: avoid; }
figcaption { font-size: .82rem; font-weight: 600; margin-bottom: .1rem; }
figcaption .q { display: block; font-weight: 400; color: #4a5060; font-size: .78rem; }
.pl-chart { width: 100%; height: 7.5rem; background: #fafbfc; border: 1px solid #d8dbe2; border-radius: 3px; }
.axis { display: flex; justify-content: space-between; gap: .5rem; font-size: .72rem;
  color: #4a5060; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.legend { list-style: none; padding: 0; margin: .3rem 0; display: flex; flex-wrap: wrap; gap: .2rem .9rem;
  font-size: .75rem; color: #4a5060; }
.legend li { display: flex; align-items: center; gap: .3rem; }
.sw { width: .7rem; height: .7rem; border-radius: 2px; display: inline-block; }
.group { break-inside: avoid-page; }
.occurrence { border-left: 2px solid #d8dbe2; padding-left: .8rem; margin: .8rem 0; break-inside: avoid; }
@media print {
  body { padding: 0; font-size: 11pt; }
  h2 { break-after: avoid; }
  a { color: inherit; text-decoration: none; }
}
@page { margin: 18mm 16mm; }
`;

const table = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  whenEmpty: string,
): string =>
  rows.length === 0
    ? `<p class="note">${escape(whenEmpty)}</p>`
    : `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${rows
        .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;

const code = (value: string): string => `<code>${escape(value)}</code>`;
const quantity = (value: number, unit: string): string => escape(formatQuantity(value, unit));
const severityTag = (severity: Severity): string =>
  `<span class="tag ${SEVERITY_TONE[severity]}">${severity}</span>`;

function renderChartFigure(panel: ChartPanel, chart: Chart): string {
  return (
    `<figure><figcaption>${escape(panel.title)}<span class="q">${escape(panel.question)}</span></figcaption>` +
    renderChartSvg(chart) +
    `<div class="axis"><span>${escape(formatNumber(chart.window.startSeconds))} s</span>` +
    `<span>${chart.series
      .map(
        (series) =>
          `${escape(series.signalId)} ${escape(formatNumber(series.min))}–${escape(formatNumber(series.max))} ${escape(series.unit)}` +
          (series.gapCount > 0
            ? ` <span class="warn">(${String(series.gapCount)} not recorded)</span>`
            : ''),
      )
      .join(' · ')}</span>` +
    `<span>${escape(formatNumber(chart.window.endSeconds))} s</span></div>` +
    (panel.missingSignalIds.length > 0
      ? `<p class="note">Not drawn, because this log does not carry it: ${panel.missingSignalIds
          .map(code)
          .join(', ')}</p>`
      : '') +
    '</figure>'
  );
}

function renderCharts(panels: readonly ChartPanel[], document: ReportDocument): string {
  const drawn = panels.filter(
    (panel): panel is ChartPanel & { chart: Chart } => panel.chart !== null,
  );
  if (drawn.length === 0) {
    return '<p class="note">No panel could be drawn: this log carries none of the signals they need.</p>';
  }

  const legendEntries = new Map<string, number>();
  for (const panel of drawn) {
    for (const band of panel.chart.bands) {
      if (!legendEntries.has(band.label)) {
        legendEntries.set(band.label, band.colorIndex);
      }
    }
  }

  const legend =
    legendEntries.size === 0
      ? ''
      : `<ul class="legend">${[...legendEntries.entries()]
          .map(
            ([label, index]) =>
              `<li><span class="sw" style="background:${modeFill(index)};opacity:.5"></span>${escape(label)}</li>`,
          )
          .join('')}</ul>`;

  const unavailable = panels.filter((panel) => panel.chart === null);

  return (
    legend +
    drawn.map((panel) => renderChartFigure(panel, panel.chart)).join('') +
    (unavailable.length > 0
      ? `<p class="note">Not shown, because this log carries none of the signals they need: ${unavailable
          .map((panel) => `${escape(panel.title)} (${panel.missingSignalIds.map(code).join(', ')})`)
          .join('; ')}</p>`
      : '') +
    (document.timeSpan === null
      ? ''
      : `<p class="note">Charts cover ${escape(formatNumber(document.timeSpan.startSeconds))} s to ` +
        `${escape(formatNumber(document.timeSpan.endSeconds))} s, the extent of the recording. ` +
        'A break in a line is a stretch that was not recorded, never a value drawn through. ' +
        'Values are in the canonical units the analysis used.</p>')
  );
}

const evidenceLine = (finding: Finding): string =>
  `<ul>${finding.evidence
    .map((reference) => {
      switch (reference.kind) {
        case 'signal-window':
          return `<li>signal ${code(reference.signalId)}, t = ${escape(formatNumber(reference.t_start_seconds))} s to ${escape(formatNumber(reference.t_end_seconds))} s</li>`;
        case 'event':
          return `<li>event ${code(reference.eventId)}</li>`;
        case 'measurement':
          return `<li>measurement on ${code(reference.signalId)} at ${escape(formatNumber(reference.t_seconds))} s: ${quantity(reference.value, reference.unit)}</li>`;
      }
    })
    .join('')}</ul>`;

function renderFindingBody(finding: Finding): string {
  return (
    `<p>${escape(finding.statement)}</p>` +
    (finding.measurements.length > 0
      ? `<h4>Measurements</h4><ul>${finding.measurements
          .map((entry) => `<li>${escape(entry.label)}: ${quantity(entry.value, entry.unit)}</li>`)
          .join('')}</ul>`
      : '') +
    (finding.thresholds.length > 0
      ? `<h4>Thresholds</h4><ul>${finding.thresholds
          .map(
            (entry) =>
              `<li>${escape(entry.label)}: ${quantity(entry.value, entry.unit)} (basis ${code(entry.basis)})</li>`,
          )
          .join('')}</ul>`
      : '') +
    `<h4>Evidence</h4>${evidenceLine(finding)}` +
    `<p class="note">Finding ${code(finding.id)}, rule ${code(finding.ruleId)} version ${code(finding.ruleVersion)}.</p>`
  );
}

function renderGroup(group: FindingGroup): string {
  const heading =
    `<h3>${severityTag(group.severity)} ${code(group.ruleId)}` +
    (group.signalIds.length === 0 ? '' : ` — ${group.signalIds.map(code).join(', ')}`) +
    '</h3>';

  if (!isRepeated(group)) {
    const [only] = group.findings;
    return `<section class="group">${heading}${only === undefined ? '' : renderFindingBody(only)}</section>`;
  }

  const peaks =
    group.peaks.length === 0
      ? ''
      : `<h4>Largest value recorded across these occurrences</h4><ul>${group.peaks
          .map(
            (peak) =>
              `<li>${escape(peak.label)}: ${quantity(peak.value, peak.unit)} (finding ${code(peak.findingId)})</li>`,
          )
          .join('')}</ul>`;

  return (
    `<section class="group">${heading}` +
    `<p>${escape(formatNumber(group.count))} occurrences` +
    (group.firstSeconds === null || group.lastSeconds === null
      ? ''
      : `, t = ${escape(formatNumber(group.firstSeconds))} s to ${escape(formatNumber(group.lastSeconds))} s`) +
    '. Each is a separate finding with its own evidence, listed below.</p>' +
    peaks +
    group.findings
      .map((finding) => `<div class="occurrence">${renderFindingBody(finding)}</div>`)
      .join('') +
    '</section>'
  );
}

export interface RenderHtmlOptions {
  /** Chart panels to draw. Omit for a text-only document — the report is complete without them. */
  readonly panels?: readonly ChartPanel[];
}

/**
 * Render a report document as a standalone HTML page.
 *
 * @throws nothing — a document that built is a document that renders.
 */
export function renderHtml(document: ReportDocument, options: RenderHtmlOptions = {}): string {
  const { provenance, counts } = document;
  const groups = groupFindings(document.findings);
  const modes = document.timeSpan === null ? [] : modeSegments(document.events, document.timeSpan);

  const body = [
    `<h1>${escape(document.title)}</h1>`,
    `<p class="lede">Generated ${code(document.generatedAtUtc)}. This timestamp is the only part of a report that changes between two runs over the same inputs and versions.</p>`,

    '<h2>Source</h2>',
    table(
      ['Field', 'Value'],
      [
        ['File', code(provenance.source.fileName)],
        ['SHA-256', code(provenance.source.sha256)],
        ['Size', `${escape(formatNumber(provenance.source.sizeBytes))} bytes`],
        ['Format', code(provenance.source.format)],
        [
          'Parser',
          `${code(provenance.source.parserPackage)} ${code(provenance.source.parserVersion)}`,
        ],
        ['Canonical model', code(provenance.schemaVersion)],
        ['Reporting', code(provenance.reportingVersion)],
        [
          'Frame class',
          provenance.vehicle.frameClass === null
            ? 'not logged'
            : code(provenance.vehicle.frameClass),
        ],
        [
          'Firmware',
          provenance.vehicle.firmwareVersion === null
            ? 'not logged'
            : code(provenance.vehicle.firmwareVersion),
        ],
      ],
      'No provenance was recorded.',
    ),

    '<h2>The flight</h2>',
    renderCharts(options.panels ?? [], document),

    '<h2>Flight modes</h2>',
    table(
      ['Mode', 'From', 'To', 'Began at', 'Ended at'],
      modes.map((segment) => [
        segment.mode === null ? 'not recorded' : escape(formatNumber(segment.mode)),
        `${escape(formatNumber(segment.startSeconds))} s`,
        `${escape(formatNumber(segment.endSeconds))} s`,
        segment.startsAtLoggedChange ? 'logged change' : 'start of data',
        segment.endsAtLoggedChange ? 'logged change' : 'end of data',
      ]),
      'This log carries no mode records, so the flight cannot be divided into modes.',
    ),
    '<p class="note">A mode is shown as the number the log recorded. The same number means different modes on different airframes — 5 is LOITER on a multirotor and FBWA on a fixed wing — and this log does not identify the airframe, so naming it would be a guess. A boundary shown as start or end of data is where the recording began or ended, not a transition the aircraft made.</p>',

    '<h2>Summary</h2>',
    `<p>Findings: ${escape(formatNumber(counts.findings))} ` +
      `(<span class="fail">CRITICAL ${escape(formatNumber(counts.findingsBySeverity.CRITICAL))}</span>, ` +
      `<span class="warn">WARNING ${escape(formatNumber(counts.findingsBySeverity.WARNING))}</span>, ` +
      `ADVISORY ${escape(formatNumber(counts.findingsBySeverity.ADVISORY))}, ` +
      `INFO ${escape(formatNumber(counts.findingsBySeverity.INFO))})</p>`,
    `<p>Verification against ${code(provenance.requirementSet.id)} version ${code(provenance.requirementSet.version)}, source ${code(provenance.requirementSet.source)}: ` +
      `<span class="pass">PASS ${escape(formatNumber(counts.outcomes.PASS))}</span>, ` +
      `<span class="fail">FAIL ${escape(formatNumber(counts.outcomes.FAIL))}</span>, ` +
      `<span class="warn">INCONCLUSIVE ${escape(formatNumber(counts.outcomes.INCONCLUSIVE))}</span>, ` +
      `NOT_APPLICABLE ${escape(formatNumber(counts.outcomes.NOT_APPLICABLE))}.</p>`,

    '<h2>Findings</h2>',
    document.findings.length === 0
      ? '<p class="note">This flight raised no findings. That is not a statement that nothing was wrong — it means no registered rule found a condition it was written to detect.</p>'
      : table(
          ['Rule', 'Severity', 'Signals', 'Occurrences', 'Span', 'Largest recorded'],
          groups.map((group) => [
            code(group.ruleId),
            severityTag(group.severity),
            group.signalIds.length === 0 ? '—' : group.signalIds.map(code).join(', '),
            escape(formatNumber(group.count)),
            group.firstSeconds === null || group.lastSeconds === null
              ? 'not time-bounded'
              : `${escape(formatNumber(group.firstSeconds))}–${escape(formatNumber(group.lastSeconds))} s`,
            group.peaks.length === 0
              ? 'no measurement recorded'
              : group.peaks
                  .map((peak) => `${escape(peak.label)} ${quantity(peak.value, peak.unit)}`)
                  .join('; '),
          ]),
          'No findings to index.',
        ) +
        '<p class="note">Grouping is presentation only: every finding below is the one the analysis produced, with its own evidence, and no figure here is a total — a summed quantity would be a measurement no finding asserts.</p>' +
        groups.map(renderGroup).join(''),

    '<h2>Verification</h2>',
    document.verification.results.length === 0
      ? '<p class="note">No requirements were evaluated.</p>'
      : document.verification.results
          .map(
            (result) =>
              `<section class="group"><h3><span class="tag ${result.outcome === 'PASS' ? 'pass' : result.outcome === 'FAIL' ? 'fail' : 'warn'}">${result.outcome}</span> ${code(result.requirementId)}</h3>` +
              `<p>${escape(result.reason)}</p>` +
              (result.evidence.length === 0
                ? '<p class="note">No evidence was cited.</p>'
                : `<h4>Evidence</h4>${evidenceLine({ evidence: result.evidence } as Finding)}`) +
              `<p class="note">Requirement version ${code(result.requirementVersion)}.</p></section>`,
          )
          .join(''),

    '<h2>Reproducibility</h2>',
    '<p class="note">Two runs over the same log at the same package versions produce identical HTML, apart from the generation timestamp above. <strong>A PDF printed from this page is not reproducible in the same sense</strong>: page size, margins and font rasterisation belong to the browser that printed it, so the PDF is a rendering of this record rather than the record itself. For an archived artifact, keep this HTML or the Markdown alongside it.</p>',
  ].join('\n');

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(document.title)}</title>`,
    `<style>${STYLE}</style>`,
    `</head><body><main>${body}</main></body></html>`,
  ].join('');
}
