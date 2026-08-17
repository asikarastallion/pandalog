<script setup lang="ts">
/**
 * The playback clock every synchronized view reads.
 *
 * One scrubber drives the map, the attitude view and the readouts, because they are all reading the
 * same `playbackTime` out of the workspace store (doc 01 §4). There is no per-view clock to drift.
 */
import type { TimeWindow } from '@pandalog/query';

import { formatSeconds } from '../workspace/format.js';

const props = defineProps<{
  window: TimeWindow;
  tSeconds: number;
  playing: boolean;
}>();

const emit = defineEmits<{
  seek: [tSeconds: number];
  setPlaying: [playing: boolean];
}>();

const STEP_SECONDS = 0.05;

const onScrub = (event: Event): void => {
  emit('seek', Number((event.target as HTMLInputElement).value));
};
</script>

<template>
  <section class="playback" aria-labelledby="playback-heading">
    <h2 id="playback-heading">Playback</h2>

    <div class="controls">
      <button
        type="button"
        class="transport"
        :aria-label="playing ? 'Pause' : 'Play'"
        @click="emit('setPlaying', !playing)"
      >
        {{ playing ? '❚❚' : '▶' }}
      </button>

      <button
        type="button"
        class="transport"
        aria-label="Back to start"
        @click="emit('seek', props.window.startSeconds)"
      >
        ⏮
      </button>

      <input
        type="range"
        class="scrubber"
        :min="window.startSeconds"
        :max="window.endSeconds"
        :step="STEP_SECONDS"
        :value="tSeconds"
        aria-label="Flight time"
        @input="onScrub"
      />

      <output class="clock">{{ formatSeconds(tSeconds) }}</output>
    </div>

    <p class="extent">
      <span>{{ formatSeconds(window.startSeconds) }}</span>
      <span>{{ formatSeconds(window.endSeconds) }}</span>
    </p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0 0 0.5rem;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.transport {
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--fg);
  font: inherit;
  font-size: 0.8rem;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  min-width: 2.2rem;
}

.transport:hover {
  border-color: var(--accent);
}

.scrubber {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.clock {
  font-family: var(--mono);
  font-size: 0.78rem;
  min-width: 5.5rem;
  text-align: right;
}

.extent {
  display: flex;
  justify-content: space-between;
  margin: 0.25rem 0 0;
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--fg-dim);
}
</style>
