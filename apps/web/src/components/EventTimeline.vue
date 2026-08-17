<script setup lang="ts">
/**
 * Every detected event across the flight.
 *
 * An event is a fact, not a judgement (doc 03 §1), so nothing here is coloured by severity — that
 * would import a claim the events layer deliberately does not make. The band shows where the open
 * investigation sits, so a finding can be placed against the whole flight.
 */
import { computed } from 'vue';

import type { FlightEvent } from '@pandalog/events';
import type { TimeWindow } from '@pandalog/query';

import { formatSeconds } from '../workspace/format.js';
import { timeToX } from '../workspace/plot.js';

const props = defineProps<{
  events: readonly FlightEvent[];
  window: TimeWindow;
  highlight: TimeWindow | null;
}>();

const WIDTH = 720;
const HEIGHT = 34;

const marks = computed(() =>
  props.events.map((event) => {
    const x = timeToX(event.t_start_seconds, props.window, WIDTH);
    const end = event.t_end_seconds ?? event.t_start_seconds;
    return {
      id: event.id,
      type: event.type,
      x,
      width: Math.max(2, timeToX(end, props.window, WIDTH) - x),
      label: `${event.type} at ${formatSeconds(event.t_start_seconds)}`,
    };
  }),
);

const band = computed(() => {
  if (props.highlight === null) {
    return null;
  }
  const x = timeToX(props.highlight.startSeconds, props.window, WIDTH);
  const end = timeToX(props.highlight.endSeconds, props.window, WIDTH);
  return { x, width: Math.max(1, end - x) };
});
</script>

<template>
  <section class="timeline" aria-labelledby="timeline-heading">
    <h2 id="timeline-heading">Timeline</h2>

    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="canvas"
      role="img"
      aria-label="Detected events across the flight"
      preserveAspectRatio="none"
    >
      <rect v-if="band" :x="band.x" :width="band.width" y="0" :height="HEIGHT" class="band" />
      <rect
        v-for="mark in marks"
        :key="mark.id"
        :x="mark.x"
        :width="mark.width"
        y="8"
        :height="HEIGHT - 16"
        class="mark"
      >
        <title>{{ mark.label }}</title>
      </rect>
    </svg>

    <p class="axis">
      <span>{{ formatSeconds(window.startSeconds) }}</span>
      <span>{{ events.length }} events</span>
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

.canvas {
  width: 100%;
  height: 34px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.band {
  fill: var(--evidence-band);
}

.mark {
  fill: var(--accent-dim);
}

.axis {
  display: flex;
  justify-content: space-between;
  margin: 0.25rem 0 0;
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--fg-dim);
}
</style>
