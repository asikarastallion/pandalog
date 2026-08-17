<script setup lang="ts">
/**
 * The landing screen — doc 01 §5.1.
 *
 * Previously analysed logs, and a way to open a new one. The list is read from IndexedDB, which is
 * local to this browser profile: there is no server (doc 01 §2), so a log listed here is on this
 * machine and nowhere else — including not in another browser on the same machine.
 *
 * What is stored is the log's own bytes plus a summary for this list. Opening an entry re-runs the
 * pipeline over those bytes rather than restoring a cached result: doc 03 §6 guarantees that is
 * byte-identical, and it means what you see is always what the code currently running concludes,
 * not what some earlier version concluded.
 */
import { computed } from 'vue';

import LogDropZone from '../components/LogDropZone.vue';
import { formatSeconds } from '../workspace/format.js';
import type { StoredLogSummary } from '../workspace/persistence.js';
import type { LoadState } from '../workspace/state.js';

const props = defineProps<{
  state: LoadState;
  recent: readonly StoredLogSummary[];
  storageAvailable: boolean;
}>();

const emit = defineEmits<{
  open: [file: File];
  reopen: [sha256: string];
  forget: [sha256: string];
}>();

const hasHistory = computed(() => props.recent.length > 0);

const formatWhen = (iso: string): string => {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? 'unknown date' : when.toLocaleString();
};

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The outcomes worth showing at a glance, in the order an engineer scans them. */
const tally = (entry: StoredLogSummary) =>
  [
    { label: 'PASS', count: entry.outcomes.PASS, tone: 'pass' },
    { label: 'FAIL', count: entry.outcomes.FAIL, tone: 'fail' },
    { label: 'INCONCLUSIVE', count: entry.outcomes.INCONCLUSIVE, tone: 'open' },
    { label: 'N/A', count: entry.outcomes.NOT_APPLICABLE, tone: 'na' },
  ].filter((outcome) => outcome.count > 0);
</script>

<template>
  <div class="landing">
    <section class="intro">
      <h2>Flight data analysis &amp; verification</h2>
      <p>
        Drop an ArduPilot <code>.BIN</code> log to decode it, detect events, run the analysis rules
        and verify it against the requirement set — entirely in this browser tab.
      </p>
    </section>

    <LogDropZone :state="state" @open="emit('open', $event)" />

    <section class="recent" aria-labelledby="recent-heading">
      <h3 id="recent-heading">Recent logs</h3>

      <p v-if="!storageAvailable" class="note">
        This browser will not allow local storage, so PandaLog cannot keep a history here. Analysis
        works exactly as it does otherwise — nothing about a log depends on it being remembered.
      </p>

      <p v-else-if="!hasHistory" class="note">
        Nothing yet. Logs you analyse are kept in this browser so you can reopen them without
        finding the file again. They are stored on this machine only — there is no server to send
        them to.
      </p>

      <ul v-else class="entries">
        <li v-for="entry in recent" :key="entry.sha256">
          <button type="button" class="entry" @click="emit('reopen', entry.sha256)">
            <span class="name">{{ entry.fileName }}</span>
            <span class="meta">
              <span>{{ formatWhen(entry.analysedAtUtc) }}</span>
              <span>{{ formatSize(entry.sizeBytes) }}</span>
              <span v-if="entry.durationSeconds !== null">
                {{ formatSeconds(entry.durationSeconds) }} of flight
              </span>
              <span>{{ entry.findingCount }} finding{{ entry.findingCount === 1 ? '' : 's' }}</span>
            </span>
            <span class="outcomes">
              <!--
                Four outcomes shown as four outcomes (doc 03 §3). A summary that collapsed
                INCONCLUSIVE into a failure — or worse, into a pass — would misrepresent the one
                distinction this tool exists to preserve.
              -->
              <span
                v-for="outcome in tally(entry)"
                :key="outcome.label"
                class="pill"
                :class="outcome.tone"
              >
                {{ outcome.count }} {{ outcome.label }}
              </span>
            </span>
            <span class="hash mono">{{ entry.sha256.slice(0, 16) }}…</span>
          </button>
          <button
            type="button"
            class="forget"
            :aria-label="`Forget ${entry.fileName}`"
            @click="emit('forget', entry.sha256)"
          >
            ✕
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.landing {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
  display: grid;
  gap: 1.5rem;
}

.intro h2 {
  margin: 0 0 0.4rem;
  font-size: 1.15rem;
}

.intro p {
  margin: 0;
  color: var(--fg-dim);
  font-size: 0.85rem;
  line-height: 1.6;
  max-width: 46rem;
}

h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0 0 0.6rem;
}

.note {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--fg-dim);
  max-width: 46rem;
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

.entries li {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
}

.entry {
  flex: 1;
  display: grid;
  gap: 0.3rem;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.7rem 0.85rem;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.entry:hover {
  border-color: var(--accent);
}

.name {
  font-size: 0.9rem;
  font-weight: 600;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.72rem;
  color: var(--fg-dim);
}

.outcomes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.pill {
  font-size: 0.66rem;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  border: 1px solid currentcolor;
}

.pill.pass {
  color: var(--pass);
}
.pill.fail {
  color: var(--fail);
}
.pill.open {
  color: var(--warn);
}
.pill.na {
  color: var(--fg-dim);
}

.hash {
  font-size: 0.66rem;
  color: var(--fg-dim);
}

.mono {
  font-family: var(--mono);
}

.forget {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg-dim);
  cursor: pointer;
  padding: 0 0.6rem;
  font-size: 0.8rem;
}

.forget:hover {
  border-color: var(--fail);
  color: var(--fail);
}
</style>
