/**
 * The two export forms markdown cannot be.
 *
 * **CSV** is where a flight-test engineer sorts and filters, and the risk is corruption a reader
 * trusts silently: a statement contains commas, so a renderer that did not quote would shift a
 * severity into the units column and the file would still open.
 *
 * **HTML** is the printable form and the PDF path. Its risks are different — a report that has to
 * fetch something is a report that can lose it, and an unescaped statement is a document that can
 * be made to lie by a rule id.
 *
 * Both are held to doc 04 §7: every value is one the artifacts already carry.
 */
import { modeSegments } from '@pandalog/events';
import { describe, expect, it } from 'vitest';

import {
  buildReport,
  flightCharts,
  renderFindingsCsv,
  renderHtml,
  renderVerificationCsv,
} from '@pandalog/reporting';

import { inputFor } from './support/artifacts.js';

/** Split a CSV line into fields, honouring RFC 4180 quoting. */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const lines = (csv: string): string[] => csv.split('\r\n').filter((line) => line.length > 0);

describe('findings as CSV', () => {
  it('emits one row per evidence reference, so the evidence chain survives the trip', async () => {
    const input = await inputFor('degraded-flight.bin');
    const csv = renderFindingsCsv(buildReport(input));
    const expected = input.findings.reduce(
      (total, finding) => total + Math.max(1, finding.evidence.length),
      0,
    );

    expect(lines(csv)).toHaveLength(expected + 1);
  });

  it('keeps every column aligned even though statements contain commas', async () => {
    const input = await inputFor('degraded-flight.bin');
    const csv = renderFindingsCsv(buildReport(input));
    const [header, ...rows] = lines(csv);
    const width = parseLine(header ?? '').length;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(parseLine(row)).toHaveLength(width);
    }
  });

  it('round-trips a statement containing a comma and a quotation mark', async () => {
    const input = await inputFor('degraded-flight.bin');
    const [first, ...rest] = input.findings;
    if (first === undefined) {
      throw new Error('The fixture no longer raises a finding.');
    }
    const awkward = { ...first, statement: 'Roll exceeded 0.17 rad, the "provisional" criterion' };

    const csv = renderFindingsCsv(buildReport({ ...input, findings: [awkward, ...rest] }));
    const statements = lines(csv)
      .slice(1)
      .map((row) => parseLine(row)[4]);

    expect(statements).toContain('Roll exceeded 0.17 rad, the "provisional" criterion');
  });

  it('keeps a measurement at full precision, not rounded for display', async () => {
    const input = await inputFor('degraded-flight.bin');
    const measurement = input.findings.flatMap((finding) => finding.measurements)[0];
    if (measurement === undefined) {
      throw new Error('The fixture no longer produces a measurement.');
    }

    // An archived record rounded to two places cannot reproduce the finding it describes.
    expect(renderFindingsCsv(buildReport(input))).toContain(String(measurement.value));
  });

  it('names every severity and rule the findings carry, and invents none', async () => {
    const input = await inputFor('degraded-flight.bin');
    const rows = lines(renderFindingsCsv(buildReport(input)))
      .slice(1)
      .map(parseLine);
    const ruleIds = new Set(input.findings.map((finding) => finding.ruleId));

    for (const row of rows) {
      expect(ruleIds.has(row[1] ?? '')).toBe(true);
    }
  });
});

describe('verification as CSV', () => {
  it('gives a result citing no evidence a row rather than omitting it', async () => {
    // A requirement that reached INCONCLUSIVE because nothing supported it is the row an engineer
    // most needs to see (doc 03 §3).
    const input = await inputFor('degraded-flight.bin');
    const document = buildReport(input);
    const rows = lines(renderVerificationCsv(document)).slice(1).map(parseLine);

    expect(rows).toHaveLength(
      document.verification.results.reduce(
        (total, result) => total + Math.max(1, result.evidence.length),
        0,
      ),
    );
    for (const result of document.verification.results) {
      expect(rows.some((row) => row[0] === result.requirementId)).toBe(true);
    }
  });

  it('prints the outcome verbatim, never collapsed into pass or fail', async () => {
    const document = buildReport(await inputFor('degraded-flight.bin'));
    const outcomes = new Set(
      lines(renderVerificationCsv(document))
        .slice(1)
        .map((row) => parseLine(row)[2]),
    );

    for (const outcome of outcomes) {
      expect(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE']).toContain(outcome);
    }
  });
});

describe('the HTML report', () => {
  const render = async (withCharts: boolean): Promise<string> => {
    const input = await inputFor('degraded-flight.bin');
    const document = buildReport(input);
    if (!withCharts || document.timeSpan === null) {
      return renderHtml(document);
    }
    return renderHtml(document, {
      panels: flightCharts(
        input.dataset,
        modeSegments(document.events, document.timeSpan),
        document.timeSpan,
        {
          size: { width: 720, height: 110 },
        },
      ),
    });
  };

  it('fetches nothing — no script, no font, no stylesheet, no image', async () => {
    const html = await render(true);

    // A report is emailed, printed and filed. Anything it has to fetch is something it can lose.
    for (const forbidden of ['<script', 'http://', 'https://', '<img', '@import', '<link']) {
      expect(html, `the HTML report references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('draws the charts markdown cannot carry', async () => {
    expect(await render(true)).toContain('<polyline');
  });

  it('is a complete report without them', async () => {
    // Charts are an addition, not a dependency. A caller with no dataset still gets the record.
    const html = await render(false);

    expect(html).toContain('<h2>Findings</h2>');
    expect(html).toContain('<h2>Verification</h2>');
    expect(html).not.toContain('<polyline');
  });

  it('states that the PDF it prints to is not reproducible, and why', async () => {
    // Byte-reproducibility is a claim this project makes and has to keep honest. Page size and font
    // rasterisation belong to the browser, so the PDF is a rendering of the record, not the record.
    const html = await render(true);

    expect(html).toContain('not reproducible in the same sense');
    expect(html).toContain('font rasterisation');
  });

  it('produces identical output for identical input', async () => {
    expect(await render(true)).toBe(await render(true));
  });

  it('escapes a statement rather than letting it close an element', async () => {
    const input = await inputFor('degraded-flight.bin');
    const [first, ...rest] = input.findings;
    if (first === undefined) {
      throw new Error('The fixture no longer raises a finding.');
    }
    const hostile = { ...first, statement: '</p><script>alert(1)</script><p>' };

    const html = renderHtml(buildReport({ ...input, findings: [hostile, ...rest] }));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('carries the same grouping and the same provenance the markdown does', async () => {
    const input = await inputFor('degraded-flight.bin');
    const html = renderHtml(buildReport(input));

    expect(html).toContain(input.dataset.provenance.sha256);
    expect(html).toContain('Grouping is presentation only');
    for (const finding of input.findings) {
      expect(html).toContain(finding.id);
    }
  });

  it('shows an outcome as itself, never collapsed', async () => {
    const html = await render(false);

    expect(html).toContain('INCONCLUSIVE');
    expect(html).toContain('NOT_APPLICABLE');
  });
});
