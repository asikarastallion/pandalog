<script setup lang="ts">
/**
 * Plot — signals chosen and drawn against each other over the flight.
 *
 * Investigation draws the signals a *finding* cites, on the window that finding covers. This is the
 * other question: an engineer picking signals for a reason of their own, over the whole flight.
 * Same renderer, different selection, and keeping them apart is doc 01 §5.1 rule 1 — a plot picker
 * bolted onto the investigation view would blur which signals are evidence and which are curiosity.
 *
 * Selection is UI state and lives in the store, so signals chosen here are still chosen when the
 * view is left and returned to.
 */
import { computed } from 'vue';

import type { PipelineResult } from '@pandalog/pipeline';
import type { TimeWindow } from '@pandalog/query';
import type { Signal } from '@pandalog/schema';

import SignalPlot from '../components/SignalPlot.vue';

const props = defineProps<{
  result: PipelineResult;
  flightWindow: TimeWindow | null;
  availableSignalIds: readonly string[];
  selectedSignalIds: readonly string[];
}>();

const emit = defineEmits<{ toggleSignal: [signalId: string] }>();

const selected = computed<Signal[]>(() =>
  props.selectedSignalIds
    .map((id) => props.result.dataset.signals.get(id))
    .filter((signal): signal is Signal => signal !== undefined),
);

/** Grouped by prefix, because a flat list of seventeen ids is a list nobody reads. */
const grouped = computed(() => {
  const groups = new Map<string, string[]>();
  for (const id of props.availableSignalIds) {
    const group = id.split('.')[0] ?? id;
    groups.set(group, [...(groups.get(group) ?? []), id]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
});
</script>

<template>
  <div class="plot-view">
    <aside class="picker" aria-label="Signals">
      <div v-for="[group, ids] in grouped" :key="group" class="group">
        <h4>{{ group }}</h4>
        <label v-for="id in ids" :key="id" class="signal">
          <input
            type="checkbox"
            :checked="selectedSignalIds.includes(id)"
            @change="emit('toggleSignal', id)"
          />
          <span class="mono">{{ id }}</span>
        </label>
      </div>
    </aside>

    <section class="canvas">
      <SignalPlot
        v-if="selected.length > 0 && flightWindow"
        :signals="selected"
        :window="flightWindow"
        :evidence-window="flightWindow"
        :events="result.events"
      />
      <p v-else class="empty">
        Choose signals on the left to draw them over the whole flight. Each is drawn in its own
        canonical unit; a gap in a trace is a stretch the log did not record, not a value of zero.
      </p>
    </section>
  </div>
</template>

<style scoped>
.plot-view {
  display: grid;
  grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.picker {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  padding: 0.7rem 0.8rem;
  max-height: 70vh;
  overflow: auto;
}

.group + .group {
  margin-top: 0.8rem;
}

h4 {
  margin: 0 0 0.3rem;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-dim);
}

.signal {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.74rem;
  padding: 0.12rem 0;
  cursor: pointer;
}

.mono {
  font-family: var(--mono);
}

.empty {
  margin: 0;
  padding: 2.5rem 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--fg-dim);
  font-size: 0.82rem;
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 68rem) {
  .plot-view {
    grid-template-columns: minmax(0, 1fr);
  }

  .picker {
    max-height: 16rem;
  }
}
</style>
