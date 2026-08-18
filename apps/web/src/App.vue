<script setup lang="ts">
/**
 * The application shell — doc 01 §5, §5.1.
 *
 * Two levels and only two: a landing screen listing previously analysed logs, and a workspace with
 * a navigation rail and one active view. This component owns the wiring — reading a file, handing
 * its bytes to the Worker, routing the result into the store, remembering it — and no domain logic
 * whatsoever (doc 04 §1 rule 1).
 *
 * Persistence stores the log's own bytes, and reopening re-runs the pipeline over them rather than
 * restoring a cached result. Doc 03 §6 guarantees that is byte-identical, so what is shown is
 * always what the code currently running concludes, not what an older version concluded.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { timeSpanOf } from '@pandalog/query';

import PlaybackControls from './components/PlaybackControls.vue';
import InvestigationView from './views/InvestigationView.vue';
import LandingView from './views/LandingView.vue';
import MapView from './views/MapView.vue';
import PlaybackView from './views/PlaybackView.vue';
import PlotView from './views/PlotView.vue';
import ReportView from './views/ReportView.vue';
import SummaryView from './views/SummaryView.vue';
import VerificationView from './views/VerificationView.vue';
import WorkspaceShell from './views/WorkspaceShell.vue';
import { createDefaultPipelineClient, type PipelineClient } from './workers/client.js';
import { LogTooLargeError, MAX_LOG_BYTES, tooLargeMessage } from './workspace/failure.js';
import {
  createAvailableLogStore,
  type StoredLog,
  type StoredLogSummary,
} from './workspace/persistence.js';
import { createWorkspace } from './workspace/state.js';

const workspace = createWorkspace();
const store = createAvailableLogStore();

const recent = ref<readonly StoredLogSummary[]>([]);
const storageAvailable = ref(true);

// Created lazily: a user who never opens a log never pays for a Worker.
const client = ref<PipelineClient | null>(null);

function pipeline(): PipelineClient {
  client.value ??= createDefaultPipelineClient();
  return client.value;
}

async function refreshRecent(): Promise<void> {
  try {
    recent.value = await store.list();
  } catch {
    // A browser refusing storage loses the history, not the application.
    storageAvailable.value = false;
    recent.value = [];
  }
}

/** Flight duration for the landing list, from the longest signal the dataset carries. */
function durationOf(result: Awaited<ReturnType<PipelineClient['analyse']>>): number | null {
  let longest: number | null = null;
  for (const signal of result.dataset.signals.values()) {
    const span = timeSpanOf(signal);
    if (span !== null) {
      longest = Math.max(longest ?? 0, span.endSeconds);
    }
  }
  return longest;
}

/** Run the pipeline over some bytes, show the result, and remember the log. */
async function analyse(fileName: string, bytes: ArrayBuffer, remember: boolean): Promise<void> {
  workspace.beginLoad(fileName);

  if (bytes.byteLength > MAX_LOG_BYTES) {
    workspace.failLoad(fileName, new LogTooLargeError(tooLargeMessage(fileName, bytes.byteLength)));
    return;
  }

  try {
    // The buffer is transferred to the Worker, so a copy is kept for storage first.
    const forStorage = remember ? bytes.slice(0) : null;

    const result = await pipeline().analyse(fileName, bytes);
    workspace.setResult(fileName, result);

    if (forStorage !== null) {
      const entry: StoredLog = {
        sha256: result.dataset.provenance.sha256,
        fileName,
        sizeBytes: result.dataset.provenance.sizeBytes,
        analysedAtUtc: new Date().toISOString(),
        durationSeconds: durationOf(result),
        findingCount: result.findings.length,
        outcomes: result.verification.summary,
        bytes: forStorage,
      };
      try {
        await store.put(entry);
        await refreshRecent();
      } catch {
        storageAvailable.value = false;
      }
    }
  } catch (error) {
    workspace.failLoad(fileName, error);
  }
}

const openFile = (file: File): void => {
  void (async () => {
    if (file.size > MAX_LOG_BYTES) {
      workspace.beginLoad(file.name);
      workspace.failLoad(file.name, new LogTooLargeError(tooLargeMessage(file.name, file.size)));
      return;
    }
    await analyse(file.name, await file.arrayBuffer(), true);
  })();
};

const reopen = (sha256: string): void => {
  void (async () => {
    const stored = await store.get(sha256);
    if (stored === null) {
      await refreshRecent();
      return;
    }
    // `remember: false` — it is already stored, and re-storing would only move it up the list for
    // having been looked at rather than for having been analysed.
    await analyse(stored.fileName, stored.bytes.slice(0), false);
  })();
};

const forget = (sha256: string): void => {
  void (async () => {
    await store.remove(sha256);
    await refreshRecent();
  })();
};

const closeLog = (): void => {
  workspace.reset();
  void refreshRecent();
};

onMounted(() => {
  void refreshRecent();
});

/** The playback loop, driven off the wall clock so playback runs at real time on any frame rate. */
let frame = 0;
let lastFrameMs = 0;

function tick(nowMs: number): void {
  const deltaSeconds = lastFrameMs === 0 ? 0 : (nowMs - lastFrameMs) / 1000;
  lastFrameMs = nowMs;
  workspace.advance(deltaSeconds);

  if (workspace.isPlaying.value) {
    frame = requestAnimationFrame(tick);
  }
}

watch(
  () => workspace.isPlaying.value,
  (playing) => {
    cancelAnimationFrame(frame);
    lastFrameMs = 0;
    if (playing) {
      frame = requestAnimationFrame(tick);
    }
  },
);

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  client.value?.dispose();
});

const result = computed(() => workspace.result.value);
const failCount = computed(() => result.value?.verification.summary.FAIL ?? 0);

/** Views that read the shared clock, so the transport bar is shown with them and only with them. */
const showsTransport = computed(
  () => workspace.activeView.value === 'map' || workspace.activeView.value === 'playback',
);
</script>

<template>
  <div class="app">
    <header>
      <h1>PandaLog</h1>
      <p class="tagline">Flight data analysis &amp; verification</p>
    </header>

    <LandingView
      v-if="result === null"
      :state="workspace.load.value"
      :recent="recent"
      :storage-available="storageAvailable"
      @open="openFile"
      @reopen="reopen"
      @forget="forget"
    />

    <WorkspaceShell
      v-else
      :active-view="workspace.activeView.value"
      :file-name="result.dataset.provenance.fileName"
      :finding-count="result.findings.length"
      :fail-count="failCount"
      @show="workspace.showView"
      @close="closeLog"
    >
      <!--
        One clock and one selection, shared by every view (doc 01 §5.1 rule 3). Switching view never
        resets them: a finding opened in Investigation is the same instant the 3D view is showing.
      -->
      <PlaybackControls
        v-if="showsTransport && workspace.flightWindow.value"
        class="transport"
        :window="workspace.flightWindow.value"
        :t-seconds="workspace.playbackTime.value"
        :playing="workspace.isPlaying.value"
        @seek="workspace.seek"
        @set-playing="workspace.setPlaying"
      />

      <SummaryView
        v-if="workspace.activeView.value === 'summary'"
        :result="result"
        :flight-window="workspace.flightWindow.value"
        :modes="workspace.modes.value"
        @show="workspace.showView"
      />

      <PlotView
        v-else-if="workspace.activeView.value === 'plot'"
        :result="result"
        :flight-window="workspace.flightWindow.value"
        :available-signal-ids="workspace.availableSignalIds.value"
        :selected-signal-ids="workspace.extraSignalIds.value"
        @toggle-signal="workspace.toggleExtraSignal"
      />

      <MapView
        v-else-if="workspace.activeView.value === 'map'"
        :track="workspace.groundTrack.value"
        :playback="workspace.playback.value"
        :modes="workspace.modes.value"
      />

      <PlaybackView
        v-else-if="workspace.activeView.value === 'playback'"
        :trajectory="workspace.trajectory.value"
        :playback="workspace.playback.value"
        :modes="workspace.modes.value"
      />

      <InvestigationView
        v-else-if="workspace.activeView.value === 'investigation'"
        :findings="workspace.findings.value"
        :selected-id="workspace.selectedFindingId.value"
        :not-applicable-rule-ids="result.notApplicableRuleIds"
        :investigation="workspace.investigation.value"
        :available-signal-ids="workspace.availableSignalIds.value"
        :extra-signal-ids="workspace.extraSignalIds.value"
        @select="workspace.selectFinding"
        @toggle-signal="workspace.toggleExtraSignal"
      />

      <VerificationView
        v-else-if="workspace.activeView.value === 'verification'"
        :verification="result.verification"
      />

      <ReportView v-else-if="workspace.activeView.value === 'report'" :result="result" />
    </WorkspaceShell>

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
  padding: 0.6rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
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

.transport {
  margin-bottom: 1rem;
}

footer {
  margin-top: auto;
  padding: 0.7rem 1.25rem;
  border-top: 1px solid var(--border);
  font-size: 0.72rem;
  color: var(--fg-dim);
}
</style>
