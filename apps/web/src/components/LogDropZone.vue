<script setup lang="ts">
/**
 * Opening a log.
 *
 * Drag-and-drop or a file picker; the bytes go straight to the Worker. Nothing is uploaded, and the
 * component says so, because "no backend" (ADR-0006) is a property a user has no way to verify by
 * looking at the page.
 *
 * The component reads a File into an ArrayBuffer and hands it on. It does not look at the bytes —
 * deciding whether they are a DataFlash log is `parser-ardupilot`'s `canParse`, reached through the
 * adapter registry (doc 04 §1 rule 2).
 */
import { ref } from 'vue';

import type { LoadState } from '../workspace/state.js';

defineProps<{ state: LoadState }>();
const emit = defineEmits<{ open: [file: File] }>();

const dragging = ref(false);

function onDrop(event: DragEvent): void {
  dragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) {
    emit('open', file);
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file !== undefined) {
    emit('open', file);
  }
  // Clear it, so re-opening the same file after a failure fires a fresh change event.
  input.value = '';
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ dragging, busy: state.status === 'loading' }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <template v-if="state.status === 'loading'">
      <p class="headline">Analysing {{ state.fileName }}…</p>
      <p class="detail">Decoding, detecting events, running rules and verifying requirements.</p>
    </template>

    <template v-else>
      <p class="headline">Drop an ArduPilot <code>.BIN</code> log here</p>
      <p class="detail">
        The log is read and analysed in this browser tab. Nothing is uploaded — PandaLog has no
        server to upload it to.
      </p>
      <label class="picker">
        <input type="file" accept=".bin,.BIN" @change="onPick" />
        <span>Choose a file</span>
      </label>
    </template>

    <!--
      Two sentences, deliberately. The first is what the domain package said, verbatim, so a user
      reporting a problem quotes the tool rather than a paraphrase of it. The second is what they
      can do about it. `role="alert"` so it is announced rather than merely appearing.
    -->
    <div v-if="state.status === 'failed'" class="failure" role="alert">
      <p class="failure-headline">
        <strong>{{ state.fileName }} could not be analysed.</strong>
      </p>
      <p class="failure-detail">{{ state.message }}</p>
      <p class="failure-guidance">{{ state.guidance }}</p>
      <p class="failure-retry">The workspace is unchanged — drop another log to try again.</p>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  padding: 1.5rem;
  text-align: center;
  background: var(--surface);
  transition: border-color 0.12s ease;
}

.dropzone.dragging {
  border-color: var(--accent);
  background: var(--surface-raised);
}

.dropzone.busy {
  border-style: solid;
}

.headline {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
}

.detail {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  color: var(--fg-dim);
  line-height: 1.5;
}

.picker input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.picker span {
  display: inline-block;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--surface-raised);
}

.picker span:hover {
  border-color: var(--accent);
}

.picker input:focus-visible + span {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.failure {
  margin: 0.9rem 0 0;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--fail);
  border-radius: 3px;
  color: var(--fail);
  font-size: 0.78rem;
  line-height: 1.5;
  text-align: left;
}

.failure p {
  margin: 0;
}

.failure-detail {
  /* The domain's own words, in the monospace face used everywhere a machine wrote the text. */
  font-family: var(--mono);
  font-size: 0.72rem;
  margin-top: 0.35rem !important;
  opacity: 0.9;
}

.failure-guidance {
  margin-top: 0.5rem !important;
  color: var(--fg);
}

.failure-retry {
  margin-top: 0.5rem !important;
  color: var(--fg-dim);
  font-size: 0.72rem;
}

code {
  font-family: var(--mono);
}
</style>
