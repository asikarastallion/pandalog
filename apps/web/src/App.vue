<script setup lang="ts">
/**
 * The workspace shell.
 *
 * One state model, several views onto it (doc 01 §4, doc 05 Phase H). This component owns the
 * wiring — reading a dropped file, handing its bytes to the Worker, routing the result into the
 * store — and no domain logic whatsoever. Every number the views render came out of the packages.
 */
import { onBeforeUnmount, ref } from 'vue';

import EventTimeline from './components/EventTimeline.vue';
import FindingsList from './components/FindingsList.vue';
import FlightSummary from './components/FlightSummary.vue';
import InvestigationPanel from './components/InvestigationPanel.vue';
import LogDropZone from './components/LogDropZone.vue';
import VerificationPanel from './components/VerificationPanel.vue';
import { createDefaultPipelineClient, type PipelineClient } from './workers/client.js';
import { createWorkspace } from './workspace/state.js';

const workspace = createWorkspace();

// Created lazily: a user who never opens a log never pays for a Worker.
const client = ref<PipelineClient | null>(null);

function pipeline(): PipelineClient {
  client.value ??= createDefaultPipelineClient();
  return client.value;
}

async function open(file: File): Promise<void> {
  workspace.beginLoad(file.name);
  try {
    const result = await pipeline().analyse(file.name, await file.arrayBuffer());
    workspace.setResult(file.name, result);
  } catch (error) {
    workspace.failLoad(file.name, error instanceof Error ? error.message : String(error));
  }
}

onBeforeUnmount(() => {
  client.value?.dispose();
});
</script>

<template>
  <div class="app">
    <header>
      <h1>PandaLog</h1>
      <p class="tagline">Flight data analysis &amp; verification</p>
      <button
        v-if="workspace.load.value.status === 'ready'"
        type="button"
        class="reset"
        @click="workspace.reset()"
      >
        Close log
      </button>
    </header>

    <main v-if="workspace.result.value === null" class="landing">
      <LogDropZone :state="workspace.load.value" @open="open" />
    </main>

    <main v-else class="workspace">
      <div class="column left">
        <FlightSummary :result="workspace.result.value" />
        <EventTimeline
          v-if="workspace.flightWindow.value"
          :events="workspace.result.value.events"
          :window="workspace.flightWindow.value"
          :highlight="workspace.investigation.value?.evidenceWindow ?? null"
        />
        <FindingsList
          :findings="workspace.findings.value"
          :selected-id="workspace.selectedFindingId.value"
          :not-applicable-rule-ids="workspace.result.value.notApplicableRuleIds"
          @select="workspace.selectFinding"
        />
      </div>

      <div class="column right">
        <InvestigationPanel
          :investigation="workspace.investigation.value"
          :available-signal-ids="workspace.availableSignalIds.value"
          :extra-signal-ids="workspace.extraSignalIds.value"
          @toggle-signal="workspace.toggleExtraSignal"
        />
        <VerificationPanel :report="workspace.result.value.verification" />
      </div>
    </main>

    <footer>Logs are read and analysed in this browser tab and are never uploaded.</footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.9rem 1.25rem;
  border-bottom: 1px solid var(--border);
}

h1 {
  margin: 0;
  font-size: 1rem;
  letter-spacing: 0.02em;
}

.tagline {
  margin: 0;
  font-size: 0.75rem;
  color: var(--fg-dim);
}

.reset {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--fg-dim);
  font: inherit;
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
}

.reset:hover {
  border-color: var(--accent);
  color: var(--fg);
}

.landing {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 2rem 1.25rem;
}

.landing > * {
  max-width: 34rem;
  width: 100%;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(20rem, 26rem) 1fr;
  gap: 1.25rem;
  padding: 1.25rem;
  align-items: start;
}

@media (max-width: 60rem) {
  .workspace {
    grid-template-columns: 1fr;
  }
}

.column {
  display: grid;
  gap: 1.25rem;
  min-width: 0;
}

footer {
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--border);
  font-size: 0.7rem;
  color: var(--fg-dim);
}
</style>
