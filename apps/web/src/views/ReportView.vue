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
 */
import { computed, ref } from 'vue';

import { buildReport, renderMarkdown } from '@pandalog/reporting';
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

const markdown = computed(() =>
  renderMarkdown(buildReport({ ...props.result, now: () => generatedAt.value })),
);

const fileName = computed(
  () => `${props.result.dataset.provenance.fileName.replace(/\.[^.]+$/, '')}.report.md`,
);

const copied = ref(false);

function download(): void {
  const blob = new Blob([markdown.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.value;
  anchor.click();

  // Released on the next turn of the event loop, once the browser has taken the data.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
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
      <button type="button" class="primary" @click="download">Download {{ fileName }}</button>
      <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy markdown' }}</button>
      <button type="button" @click="regenerate">Re-stamp</button>
    </div>

    <p class="note">
      Produced by <code>@pandalog/reporting</code> — the same package the CLI's
      <code>--format=markdown</code> uses, over the same result. Two runs over one log at the same
      versions differ only in the generation timestamp, which is why it sits outside the provenance
      block. Every value in it comes from the analysis; the renderer computes nothing.
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
