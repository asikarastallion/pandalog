<script setup lang="ts">
/**
 * The report, in the browser.
 *
 * Rendered by `@pandalog/reporting` — the same package `pandalog verify --format=markdown` calls,
 * over the same `PipelineResult`. Not a second implementation: doc 04 §7 says a number in a report
 * must be traceable to analysis output, and two renderers would be two chances to break that. What
 * downloads here is byte-identical to what CI produces for the same log at the same versions, apart
 * from the generation timestamp.
 *
 * Downloading is a Blob and an object URL: no server, nothing uploaded, and the file is assembled
 * in the tab from data already in it.
 *
 * Four forms, one document. Markdown is the archival one — it diffs in review and is
 * byte-reproducible. HTML carries the charts markdown cannot, and is the PDF path: there is no PDF
 * library (doc 04 §9), because the browser already has a typesetter, and the page says plainly that
 * the PDF it prints to is *not* reproducible in the way the HTML is. CSV is for a spreadsheet and
 * therefore carries full precision rather than the six significant figures prose is rounded to.
 */
import { computed, ref } from 'vue';

import { modeSegments } from '@pandalog/events';
import {
  buildReport,
  flightCharts,
  renderFindingsCsv,
  renderHtml,
  renderMarkdown,
  renderVerificationCsv,
} from '@pandalog/reporting';
import type { PipelineResult } from '@pandalog/pipeline';

const props = defineProps<{ result: PipelineResult }>();

/**
 * The clock is read once, when the view is opened.
 *
 * A `new Date()` evaluated inside the computed would re-stamp the report on every reactive read,
 * so the text would change while nothing about the flight had — exactly the instability the
 * reproducibility criterion is about.
 */
const generatedAt = ref(new Date());

/** Chart size in user units — the same the CLI's HTML export uses, so both pages look alike. */
const REPORT_CHART_SIZE = { width: 720, height: 110 };

const report = computed(() => buildReport({ ...props.result, now: () => generatedAt.value }));

const markdown = computed(() => renderMarkdown(report.value));

const stem = computed(() => props.result.dataset.provenance.fileName.replace(/\.[^.]+$/, ''));
const fileName = computed(() => `${stem.value}.report.md`);

const copied = ref(false);

function html(): string {
  const document_ = report.value;
  return renderHtml(document_, {
    panels:
      document_.timeSpan === null
        ? []
        : flightCharts(
            props.result.dataset,
            modeSegments(document_.events, document_.timeSpan),
            document_.timeSpan,
            { size: REPORT_CHART_SIZE },
          ),
  });
}

function save(contents: string, name: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();

  // Released on the next turn of the event loop, once the browser has taken the data.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

const download = (): void => {
  save(markdown.value, fileName.value, 'text/markdown');
};

const downloadHtml = (): void => {
  save(html(), `${stem.value}.report.html`, 'text/html');
};

const downloadFindingsCsv = (): void => {
  save(renderFindingsCsv(report.value), `${stem.value}.findings.csv`, 'text/csv');
};

const downloadVerificationCsv = (): void => {
  save(renderVerificationCsv(report.value), `${stem.value}.verification.csv`, 'text/csv');
};

const downloadJson = (): void => {
  // The pipeline result as the CLI's --format=json writes it, so a browser run and a CI run hand
  // the same document to whatever consumes it next.
  save(
    `${JSON.stringify(report.value, null, 2)}\n`,
    `${stem.value}.report.json`,
    'application/json',
  );
};

/**
 * Print the HTML report, which is how a PDF is produced.
 *
 * A hidden iframe rather than printing this page: the workspace's own chrome — rail, filters,
 * controls — is not part of the document, and a print stylesheet hiding it would be a second
 * definition of what the report contains. The iframe prints the same bytes the HTML download
 * produces, so what is filed and what is printed cannot differ.
 */
function printReport(): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '100%';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html();

  frame.addEventListener('load', () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Removed after the dialog has taken the document; removing it synchronously cancels the print.
    setTimeout(() => {
      frame.remove();
    }, 1000);
  });

  document.body.appendChild(frame);
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdown.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // A browser refusing clipboard access is not worth an error state; the text is on screen and
    // selectable, and the download always works.
    copied.value = false;
  }
}

function regenerate(): void {
  generatedAt.value = new Date();
}
</script>

<template>
  <div class="report-view">
    <div class="actions">
      <button type="button" class="primary" @click="download">Markdown</button>
      <button type="button" @click="downloadHtml">HTML (with charts)</button>
      <button type="button" @click="printReport">Print / PDF</button>
      <button type="button" @click="downloadFindingsCsv">Findings CSV</button>
      <button type="button" @click="downloadVerificationCsv">Verification CSV</button>
      <button type="button" @click="downloadJson">JSON</button>
      <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy markdown' }}</button>
      <button type="button" @click="regenerate">Re-stamp</button>
    </div>

    <p class="note">
      Produced by <code>@pandalog/reporting</code> — the same package the CLI uses, over the same
      result, so a browser run and a CI run produce the same document. Two runs over one log at the
      same versions differ only in the generation timestamp, which is why it sits outside the
      provenance block. Every value comes from the analysis; the renderer computes nothing.
    </p>

    <p class="note">
      <strong>Markdown</strong> is the archival form: it diffs in review and is byte-reproducible.
      <strong>HTML</strong> adds the signal charts markdown cannot carry, and is what
      <strong>Print / PDF</strong> typesets — a PDF is <em>not</em> reproducible in the same sense,
      because page size, margins and font rasterisation belong to the browser that printed it; the
      page says so itself. <strong>CSV</strong> carries full precision rather than the six
      significant figures prose rounds to, because a spreadsheet is computed on rather than read.
      The download below is <code>{{ fileName }}</code
      >.
    </p>

    <pre class="document">{{ markdown }}</pre>
  </div>
</template>

<style scoped>
.report-view {
  display: grid;
  gap: 0.8rem;
  min-width: 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.actions button {
  font: inherit;
  font-size: 0.78rem;
  padding: 0.35rem 0.7rem;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--fg);
  cursor: pointer;
}

.actions button:hover {
  border-color: var(--accent);
}

.actions .primary {
  border-color: var(--accent);
  color: var(--accent);
}

.note {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--fg-dim);
  max-width: 52rem;
}

.document {
  margin: 0;
  padding: 1rem;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--mono);
  font-size: 0.72rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 70vh;
  overflow: auto;
}

code {
  font-family: var(--mono);
}
</style>
